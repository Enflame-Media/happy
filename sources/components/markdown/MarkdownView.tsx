import { MarkdownSpan, parseMarkdown } from './parseMarkdown';
import { Link } from 'expo-router';
import * as React from 'react';
import { ScrollView, View, Platform, Pressable, InteractionManager, Animated } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '../StyledText';
import { Typography } from '@/constants/Typography';
import { SimpleSyntaxHighlighter } from '../SimpleSyntaxHighlighter';
import { Modal } from '@/modal';
import { useLocalSetting } from '@/sync/storage';
import { storeTempText } from '@/sync/persistence';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { MermaidRenderer } from './MermaidRenderer';
import { t } from '@/text';

// Constants for lazy code block rendering
const CODE_LINE_HEIGHT = 20;
const CODE_PADDING_VERTICAL = 32; // 16px top + 16px bottom
const CODE_LANGUAGE_HEIGHT = 20; // Approximate height of language label
const MIN_CODE_BLOCK_HEIGHT = 56;

// Option type for callback
export type Option = {
    title: string;
};

export const MarkdownView = React.memo((props: { 
    markdown: string;
    onOptionPress?: (option: Option) => void;
}) => {
    const blocks = React.useMemo(() => parseMarkdown(props.markdown), [props.markdown]);
    
    // Backwards compatibility: The original version just returned the view, wrapping the list of blocks.
    // It made each of the individual text elements selectable. When we enable the markdownCopyV2 feature,
    // we disable the selectable property on individual text segments on mobile only. Instead, the long press
    // will be handled by a wrapper Pressable. If we don't disable the selectable property, then you will see
    // the native copy modal come up at the same time as the long press handler is fired.
    const markdownCopyV2 = useLocalSetting('markdownCopyV2');
    const selectable = Platform.OS === 'web' || !markdownCopyV2;
    const router = useRouter();

    const handleLongPress = React.useCallback(() => {
        try {
            const textId = storeTempText(props.markdown);
            router.push(`/text-selection?textId=${textId}`);
        } catch (error) {
            console.error('Error storing text for selection:', error);
            Modal.alert('Error', 'Failed to open text selection. Please try again.');
        }
    }, [props.markdown, router]);
    const renderContent = () => {
        return (
            <View>
                {blocks.map((block, index) => {
                    if (block.type === 'text') {
                        return <RenderTextBlock spans={block.content} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
                    } else if (block.type === 'header') {
                        return <RenderHeaderBlock level={block.level} spans={block.content} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
                    } else if (block.type === 'horizontal-rule') {
                        return <View style={style.horizontalRule} key={index} />;
                    } else if (block.type === 'list') {
                        return <RenderListBlock items={block.items} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
                    } else if (block.type === 'numbered-list') {
                        return <RenderNumberedListBlock items={block.items} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
                    } else if (block.type === 'code-block') {
                        return <RenderCodeBlock content={block.content} language={block.language} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
                    } else if (block.type === 'mermaid') {
                        return <MermaidRenderer content={block.content} key={index} />;
                    } else if (block.type === 'options') {
                        return <RenderOptionsBlock items={block.items} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} onOptionPress={props.onOptionPress} />;
                    } else if (block.type === 'table') {
                        return <RenderTableBlock headers={block.headers} rows={block.rows} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
                    } else {
                        return null;
                    }
                })}
            </View>
        );
    }

    if (!markdownCopyV2) {
        return renderContent();
    }
    
    if (Platform.OS === 'web') {
        return renderContent();
    }
    
    return <Pressable onLongPress={handleLongPress} delayLongPress={500}>{renderContent()}</Pressable>;
});

function RenderTextBlock(props: { spans: MarkdownSpan[], first: boolean, last: boolean, selectable: boolean }) {
    return <Text selectable={props.selectable} style={[style.text, props.first && style.first, props.last && style.last]}><RenderSpans spans={props.spans} baseStyle={style.text} /></Text>;
}

function RenderHeaderBlock(props: { level: 1 | 2 | 3 | 4 | 5 | 6, spans: MarkdownSpan[], first: boolean, last: boolean, selectable: boolean }) {
    const s = (style as any)[`header${props.level}`];
    const headerStyle = [style.header, s, props.first && style.first, props.last && style.last];
    return <Text selectable={props.selectable} style={headerStyle}><RenderSpans spans={props.spans} baseStyle={headerStyle} /></Text>;
}

function RenderListBlock(props: { items: MarkdownSpan[][], first: boolean, last: boolean, selectable: boolean }) {
    const listStyle = [style.text, style.list];
    return (
        <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }}>
            {props.items.map((item, index) => (
                <Text selectable={props.selectable} style={listStyle} key={index}>- <RenderSpans spans={item} baseStyle={listStyle} /></Text>
            ))}
        </View>
    );
}

function RenderNumberedListBlock(props: { items: { number: number, spans: MarkdownSpan[] }[], first: boolean, last: boolean, selectable: boolean }) {
    const listStyle = [style.text, style.list];
    return (
        <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }}>
            {props.items.map((item, index) => (
                <Text selectable={props.selectable} style={listStyle} key={index}>{item.number.toString()}. <RenderSpans spans={item.spans} baseStyle={listStyle} /></Text>
            ))}
        </View>
    );
}

/**
 * Lazy-loaded code block component that defers expensive syntax highlighting
 * until after the initial render pass completes.
 *
 * This improves performance when rendering messages with multiple code blocks
 * by showing a placeholder first, then fading in the highlighted code.
 * The estimated height prevents layout shift during the transition.
 */
function RenderCodeBlock(props: { content: string, language: string | null, first: boolean, last: boolean, selectable: boolean }) {
    const [isReady, setIsReady] = React.useState(false);
    const [isHovered, setIsHovered] = React.useState(false);
    const opacity = React.useRef(new Animated.Value(0)).current;

    // Calculate estimated height to prevent layout shift
    // Line count * line height + padding + language label (if present)
    const lineCount = props.content.split('\n').length;
    const estimatedHeight = Math.max(
        lineCount * CODE_LINE_HEIGHT + CODE_PADDING_VERTICAL + (props.language ? CODE_LANGUAGE_HEIGHT : 0),
        MIN_CODE_BLOCK_HEIGHT
    );

    const copyCode = React.useCallback(async () => {
        try {
            // Haptic feedback on native platforms for tactile confirmation
            if (Platform.OS !== 'web') {
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            await Clipboard.setStringAsync(props.content);
            Modal.alert(t('common.success'), t('markdown.codeCopied'), [{ text: t('common.ok'), style: 'cancel' }]);
        } catch (error) {
            console.error('Failed to copy code:', error);
            Modal.alert(t('common.error'), t('markdown.copyFailed'), [{ text: t('common.ok'), style: 'cancel' }]);
        }
    }, [props.content]);

    React.useEffect(() => {
        // Defer syntax highlighting until after interactions complete
        // This allows the FlatList to finish scrolling/rendering first
        const task = InteractionManager.runAfterInteractions(() => {
            setIsReady(true);
            Animated.timing(opacity, {
                toValue: 1,
                duration: 150,
                useNativeDriver: Platform.OS !== 'web',
            }).start();
        });
        return () => task.cancel();
    }, [opacity]);

    // Code block content shared between web and native
    const codeBlockContent = (
        <>
            {props.language && <Text selectable={props.selectable} style={style.codeLanguage}>{props.language}</Text>}
            {!isReady ? (
                // Placeholder: Same background, just empty space
                // The minHeight on parent maintains layout stability
                <View style={style.codeBlockPlaceholder} />
            ) : (
                <Animated.View style={{ opacity }}>
                    <ScrollView
                        style={{ flexGrow: 0, flexShrink: 0 }}
                        horizontal={true}
                        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
                        showsHorizontalScrollIndicator={false}
                    >
                        <SimpleSyntaxHighlighter
                            code={props.content}
                            language={props.language}
                            selectable={props.selectable}
                        />
                    </ScrollView>
                </Animated.View>
            )}
            {/* Web-only: Copy button appears on hover */}
            {Platform.OS === 'web' && (
                <View style={[style.copyButtonWrapper, isHovered && style.copyButtonWrapperVisible]}>
                    <Pressable style={style.copyButton} onPress={copyCode}>
                        <Text style={style.copyButtonText}>{t('common.copy')}</Text>
                    </Pressable>
                </View>
            )}
        </>
    );

    // Native platforms: Long-press to copy with haptic feedback
    // Web: Hover-based copy button (unchanged)
    if (Platform.OS !== 'web') {
        return (
            <Pressable
                onLongPress={copyCode}
                delayLongPress={400}
                style={[style.codeBlock, props.first && style.first, props.last && style.last, { minHeight: estimatedHeight }]}
            >
                {codeBlockContent}
            </Pressable>
        );
    }

    return (
        <View
            style={[style.codeBlock, props.first && style.first, props.last && style.last, { minHeight: estimatedHeight }]}
            // @ts-ignore - Web only events for hover copy button
            onMouseEnter={() => setIsHovered(true)}
            // @ts-ignore - Web only events
            onMouseLeave={() => setIsHovered(false)}
        >
            {codeBlockContent}
        </View>
    );
}

function RenderOptionsBlock(props: { 
    items: string[], 
    first: boolean, 
    last: boolean, 
    selectable: boolean,
    onOptionPress?: (option: Option) => void 
}) {
    return (
        <View style={[style.optionsContainer, props.first && style.first, props.last && style.last]}>
            {props.items.map((item, index) => {
                if (props.onOptionPress) {
                    return (
                        <Pressable 
                            key={index} 
                            style={({ pressed }) => [
                                style.optionItem,
                                pressed && style.optionItemPressed
                            ]}
                            onPress={() => props.onOptionPress?.({ title: item })}
                        >
                            <Text selectable={props.selectable} style={style.optionText}>{item}</Text>
                        </Pressable>
                    );
                } else {
                    return (
                        <View key={index} style={style.optionItem}>
                            <Text selectable={props.selectable} style={style.optionText}>{item}</Text>
                        </View>
                    );
                }
            })}
        </View>
    );
}

function RenderSpans(props: { spans: MarkdownSpan[], baseStyle?: any }) {
    return (<>
        {props.spans.map((span, index) => {
            if (span.url) {
                return <Link key={index} href={span.url as any} target="_blank" style={[style.link, span.styles.map(s => style[s])]}>{span.text}</Link>
            } else {
                return <Text key={index} selectable style={[props.baseStyle, span.styles.map(s => style[s])]}>{span.text}</Text>
            }
        })}
    </>)
}

function RenderTableBlock(props: {
    headers: string[],
    rows: string[][],
    first: boolean,
    last: boolean,
    selectable: boolean
}) {
    return (
        <View style={[style.tableContainer, props.first && style.first, props.last && style.last]}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={true}
                style={{ flex: 1 }}
                contentContainerStyle={{ minWidth: '100%' }}
            >
                <View style={{ flexDirection: 'column', minWidth: '100%' }}>
                    <View style={style.tableRow}>
                        {props.headers.map((header, index) => (
                            <View key={`header-${index}`} style={[style.tableCell, style.tableHeaderCell]}>
                                <Text selectable={props.selectable} style={style.tableHeaderText}>{header}</Text>
                            </View>
                        ))}
                    </View>
                    {props.rows.map((row, rowIndex) => (
                        <View key={`row-${rowIndex}`} style={[style.tableRow, rowIndex === props.rows.length - 1 && style.tableRowLast]}>
                            {props.headers.map((_, cellIndex) => (
                                <View key={`cell-${rowIndex}-${cellIndex}`} style={style.tableCell}>
                                    <Text selectable={props.selectable} style={style.tableCellText}>{row[cellIndex] ?? ''}</Text>
                                </View>
                            ))}
                        </View>
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}


const style = StyleSheet.create((theme) => ({

    // Plain text

    text: {
        ...Typography.default(),
        fontSize: 16,
        lineHeight: 24, // Reduced from 28 to 24
        marginTop: 8,
        marginBottom: 8,
        color: theme.colors.text,
        fontWeight: '400',
    },

    italic: {
        fontStyle: 'italic',
    },
    bold: {
        fontWeight: 'bold',
    },
    semibold: {
        fontWeight: '600',
    },
    code: {
        ...Typography.mono(),
        fontSize: 16,
        lineHeight: 21,  // Reduced from 24 to 21
        backgroundColor: theme.colors.surfaceHighest,
        color: theme.colors.text,
    },
    link: {
        ...Typography.default(),
        color: theme.colors.textLink,
        fontWeight: '400',
    },

    // Headers

    header: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
    },
    header1: {
        fontSize: 16,
        lineHeight: 24,  // Reduced from 36 to 24
        fontWeight: '900',
        marginTop: 16,
        marginBottom: 8
    },
    header2: {
        fontSize: 20,
        lineHeight: 24,  // Reduced from 36 to 32
        fontWeight: '600',
        marginTop: 16,
        marginBottom: 8
    },
    header3: {
        fontSize: 16,
        lineHeight: 28,  // Reduced from 32 to 28
        fontWeight: '600',
        marginTop: 16,
        marginBottom: 8,
    },
    header4: {
        fontSize: 16,
        lineHeight: 24,
        fontWeight: '600',
        marginTop: 8,
        marginBottom: 8,
    },
    header5: {
        fontSize: 16,
        lineHeight: 24,  // Reduced from 28 to 24
        fontWeight: '600'
    },
    header6: {
        fontSize: 16,
        lineHeight: 24, // Reduced from 28 to 24
        fontWeight: '600'
    },

    //
    // List
    //

    list: {
        ...Typography.default(),
        color: theme.colors.text,
        marginTop: 0,
        marginBottom: 0,
    },

    //
    // Common
    //

    first: {
        // marginTop: 0
    },
    last: {
        // marginBottom: 0
    },

    //
    // Code Block
    //

    codeBlock: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        marginVertical: 8,
    },
    codeBlockPlaceholder: {
        // Empty placeholder that maintains the space while code loads
        // Parent container's minHeight ensures consistent sizing
        flex: 1,
    },
    codeLanguage: {
        ...Typography.mono(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 8,
        paddingHorizontal: 16,
        marginBottom: 0,
    },
    codeText: {
        ...Typography.mono(),
        color: theme.colors.text,
        fontSize: 14,
        lineHeight: 20,
    },
    horizontalRule: {
        height: 1,
        backgroundColor: theme.colors.divider,
        marginTop: 8,
        marginBottom: 8,
    },

    //
    // Options Block
    //

    optionsContainer: {
        flexDirection: 'column',
        gap: 8,
        marginVertical: 8,
    },
    optionItem: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    optionItemPressed: {
        opacity: 0.7,
        backgroundColor: theme.colors.surfaceHigh,
    },
    optionText: {
        ...Typography.default(),
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.text,
    },

    //
    // Copy Button (Web only)
    //

    copyButtonWrapper: {
        position: 'absolute',
        top: 8,
        right: 8,
        opacity: 0,
        transitionDuration: '150ms',
        transitionProperty: 'opacity',
    },
    copyButtonWrapperVisible: {
        opacity: 1,
    },
    copyButton: {
        backgroundColor: theme.colors.surfaceHigh,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    copyButtonText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },

    //
    // Table
    //

    tableContainer: {
        marginVertical: 8,
        borderRadius: 8,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    tableRowLast: {
        borderBottomWidth: 0,
    },
    tableCell: {
        flex: 1,
        minWidth: 100,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRightWidth: 1,
        borderRightColor: theme.colors.divider,
    },
    tableHeaderCell: {
        backgroundColor: theme.colors.surfaceHighest,
    },
    tableHeaderText: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    tableCellText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
    },
}));