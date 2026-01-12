import * as React from 'react';
import { View, Platform, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

/**
 * MermaidRenderer - Renders Mermaid diagrams securely across all platforms.
 *
 * Security: Uses postMessage to pass diagram content to a sandboxed WebView/iframe,
 * preventing XSS vulnerabilities. The HTML template contains no user content -
 * content is passed via postMessage after load and rendered using mermaid.render().
 * SVG output is sanitized using DOMPurify before insertion.
 */
export const MermaidRenderer = React.memo((props: {
    content: string;
}) => {
    const { theme } = useUnistyles();
    const [dimensions, setDimensions] = React.useState({ width: 0, height: 200 });
    const [hasError, setHasError] = React.useState(false);
    const iframeRef = React.useRef<HTMLIFrameElement>(null);
    const webViewRef = React.useRef<WebView>(null);

    const onLayout = React.useCallback((event: { nativeEvent: { layout: { width: number } } }) => {
        const { width } = event.nativeEvent.layout;
        setDimensions(prev => ({ ...prev, width }));
    }, []);

    // Generate the HTML content for mermaid rendering
    // SECURITY: No user content is interpolated into the HTML template.
    // Content is passed via postMessage after the WebView/iframe loads.
    // SVG output from mermaid is sanitized with DOMPurify before DOM insertion.
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    padding: 16px;
                    background-color: ${theme.colors.surfaceHighest};
                    min-height: 100px;
                }
                #mermaid-container {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    width: 100%;
                }
                #mermaid-output {
                    text-align: center;
                    width: 100%;
                }
                #mermaid-output svg {
                    max-width: 100%;
                    height: auto;
                }
                .error {
                    color: #ff6b6b;
                    font-family: monospace;
                    padding: 16px;
                    background: rgba(255,0,0,0.1);
                    border-radius: 4px;
                    word-break: break-word;
                }
                .loading {
                    color: #888;
                    font-family: sans-serif;
                    padding: 16px;
                }
            </style>
        </head>
        <body>
            <div id="mermaid-container">
                <div id="mermaid-output" class="loading">Loading diagram...</div>
            </div>
            <script>
                // Initialize mermaid with strict security
                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'dark',
                    securityLevel: 'strict'
                });

                // Track last reported height to avoid duplicate messages
                var lastReportedHeight = 0;

                // Report height changes to parent
                function reportHeight() {
                    var container = document.getElementById('mermaid-container');
                    var height = container ? container.scrollHeight : document.body.scrollHeight;
                    if (container) {
                        var rect = container.getBoundingClientRect();
                        height = Math.max(height, Math.ceil(rect.height));
                    }
                    height += 32; // Body padding

                    if (Math.abs(height - lastReportedHeight) < 2) {
                        return;
                    }
                    lastReportedHeight = height;

                    if (window.ReactNativeWebView) {
                        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'dimensions', height: height }));
                    } else if (window.parent !== window) {
                        window.parent.postMessage({ type: 'mermaid-height', height: height }, '*');
                    }
                }

                // Debounced version for frequent events
                var reportHeightTimeout = null;
                function reportHeightDebounced() {
                    if (reportHeightTimeout) {
                        clearTimeout(reportHeightTimeout);
                    }
                    reportHeightTimeout = setTimeout(reportHeight, 50);
                }

                window.addEventListener('resize', reportHeightDebounced);

                var observer = new MutationObserver(function(mutations) {
                    reportHeightDebounced();
                });
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    characterData: true
                });

                // Safely clear all children from an element
                function clearChildren(element) {
                    while (element.firstChild) {
                        element.removeChild(element.firstChild);
                    }
                }

                // Render the mermaid diagram from received content
                function renderDiagram(diagramSource) {
                    var outputElement = document.getElementById('mermaid-output');
                    outputElement.className = '';
                    clearChildren(outputElement);

                    // Use mermaid.render() to safely render the diagram
                    // This treats the content as data, not HTML
                    mermaid.render('mermaid-diagram', diagramSource)
                        .then(function(result) {
                            // Sanitize SVG output with DOMPurify before insertion
                            var sanitizedSvg = DOMPurify.sanitize(result.svg, {
                                USE_PROFILES: { svg: true, svgFilters: true },
                                ADD_TAGS: ['foreignObject']
                            });
                            // Parse sanitized SVG and append as DOM nodes
                            var parser = new DOMParser();
                            var svgDoc = parser.parseFromString(sanitizedSvg, 'image/svg+xml');
                            var svgElement = svgDoc.documentElement;
                            if (svgElement && svgElement.nodeName === 'svg') {
                                clearChildren(outputElement);
                                outputElement.appendChild(document.adoptNode(svgElement));
                            }
                            requestAnimationFrame(function() {
                                reportHeight();
                                setTimeout(reportHeight, 100);
                                setTimeout(reportHeight, 500);
                            });
                        })
                        .catch(function(err) {
                            clearChildren(outputElement);
                            var errorDiv = document.createElement('div');
                            errorDiv.className = 'error';
                            errorDiv.textContent = 'Diagram error: ' + (err.message || 'Unknown error');
                            outputElement.appendChild(errorDiv);
                            reportHeight();
                        });
                }

                // Listen for content via postMessage (from parent window or React Native)
                window.addEventListener('message', function(event) {
                    var data = event.data;
                    // Handle string messages (from React Native WebView)
                    if (typeof data === 'string') {
                        try {
                            data = JSON.parse(data);
                        } catch (e) {
                            return;
                        }
                    }
                    if (data && data.type === 'mermaid-content' && typeof data.content === 'string') {
                        renderDiagram(data.content);
                    }
                });

                // Signal that we're ready to receive content
                if (window.ReactNativeWebView) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
                } else if (window.parent !== window) {
                    window.parent.postMessage({ type: 'mermaid-ready' }, '*');
                }
            </script>
        </body>
        </html>
    `;

    // Handle messages from iframe and send content (web only)
    React.useEffect(() => {
        if (Platform.OS !== 'web') return;

        const handleMessage = (event: MessageEvent) => {
            // Handle ready signal - send the mermaid content
            if (event.data?.type === 'mermaid-ready') {
                const iframe = iframeRef.current;
                if (iframe?.contentWindow) {
                    iframe.contentWindow.postMessage(
                        { type: 'mermaid-content', content: props.content },
                        '*'
                    );
                }
            }
            // Handle height updates
            if (event.data?.type === 'mermaid-height' && typeof event.data.height === 'number') {
                setDimensions(prev => ({
                    ...prev,
                    height: Math.max(100, event.data.height + 32)
                }));
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [props.content]);

    // Send updated content when props.content changes (web only)
    React.useEffect(() => {
        if (Platform.OS !== 'web') return;

        const iframe = iframeRef.current;
        if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage(
                { type: 'mermaid-content', content: props.content },
                '*'
            );
        }
    }, [props.content]);

    // Web platform uses sandboxed iframe
    if (Platform.OS === 'web') {
        const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

        return (
            <View style={style.container}>
                {/* @ts-ignore - Web only iframe element */}
                <iframe
                    ref={iframeRef}
                    src={dataUrl}
                    sandbox="allow-scripts"
                    style={{
                        width: '100%',
                        height: dimensions.height,
                        border: 'none',
                        borderRadius: 8,
                        backgroundColor: theme.colors.surfaceHighest,
                    }}
                    title="Mermaid Diagram"
                />
            </View>
        );
    }

    // For iOS/Android, use WebView (inherently sandboxed)
    // Send content via injectedJavaScript after the WebView signals ready
    const handleWebViewMessage = React.useCallback((event: { nativeEvent: { data: string } }) => {
        try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === 'ready' && webViewRef.current) {
                // Send the mermaid content to the WebView
                const contentMessage = JSON.stringify({ type: 'mermaid-content', content: props.content });
                webViewRef.current.postMessage(contentMessage);
            }
            if (data.type === 'dimensions' && typeof data.height === 'number') {
                setDimensions(prev => ({
                    ...prev,
                    height: Math.max(100, data.height + 32)
                }));
            }
        } catch {
            // Ignore parse errors
        }
    }, [props.content]);

    // Send updated content when props.content changes (native)
    React.useEffect(() => {
        if (Platform.OS === 'web') return;

        if (webViewRef.current) {
            const contentMessage = JSON.stringify({ type: 'mermaid-content', content: props.content });
            webViewRef.current.postMessage(contentMessage);
        }
    }, [props.content]);

    return (
        <View style={style.container} onLayout={onLayout}>
            <View style={[style.innerContainer, { height: dimensions.height }]}>
                <WebView
                    ref={webViewRef}
                    source={{ html }}
                    style={{ flex: 1 }}
                    scrollEnabled={false}
                    // HAP-623: Block all external navigation - MermaidRenderer only renders local HTML
                    originWhitelist={[]}
                    onShouldStartLoadWithRequest={() => false}
                    onMessage={handleWebViewMessage}
                    onError={() => setHasError(true)}
                />
            </View>
            {hasError && (
                <View style={style.errorOverlay}>
                    <Text style={style.errorText}>Failed to render diagram</Text>
                </View>
            )}
        </View>
    );
});

const style = StyleSheet.create((theme) => ({
    container: {
        marginVertical: 8,
        width: '100%',
    },
    innerContainer: {
        width: '100%',
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        overflow: 'hidden',
    },
    errorOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
    },
    errorText: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 14,
    },
}));
