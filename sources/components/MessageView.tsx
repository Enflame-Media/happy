import * as React from "react";
import { View, Text, Pressable, LayoutAnimation } from "react-native";
import { StyleSheet } from 'react-native-unistyles';
import { MarkdownView } from "./markdown/MarkdownView";
import { t } from '@/text';
import { Message, UserTextMessage, AgentTextMessage, ToolCallMessage } from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { layout } from "./layout";
import { ToolView } from "./tools/ToolView";
import { AgentEvent } from "@/sync/typesRaw";
import { sync } from '@/sync/sync';
import { Option } from './markdown/MarkdownView';
import { AppError, ErrorCodes } from '@/utils/errors';

// Truncation thresholds for long messages
const LINE_THRESHOLD = 50;  // Truncate if message has more than this many lines
const INITIAL_LINES = 20;   // Show this many lines when truncated

export const MessageView = React.memo((props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
}) => {
  return (
    <View style={styles.messageContainer} renderToHardwareTextureAndroid={true}>
      <View style={styles.messageContent}>
        <RenderBlock
          message={props.message}
          metadata={props.metadata}
          sessionId={props.sessionId}
          getMessageById={props.getMessageById}
        />
      </View>
    </View>
  );
});

// RenderBlock function that dispatches to the correct component based on message kind
function RenderBlock(props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
}): React.ReactElement {
  switch (props.message.kind) {
    case 'user-text':
      return <UserTextBlock message={props.message} sessionId={props.sessionId} />;

    case 'agent-text':
      return <AgentTextBlock message={props.message} sessionId={props.sessionId} />;

    case 'tool-call':
      return <ToolCallBlock
        message={props.message}
        metadata={props.metadata}
        sessionId={props.sessionId}
        getMessageById={props.getMessageById}
      />;

    case 'agent-event':
      return <AgentEventBlock event={props.message.event} metadata={props.metadata} />;


    default:
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustive: never = props.message;
      throw new AppError(ErrorCodes.INTERNAL_ERROR, `Unknown message kind: ${_exhaustive}`);
  }
}

function UserTextBlock(props: {
  message: UserTextMessage;
  sessionId: string;
}) {
  const [expanded, setExpanded] = React.useState(false);

  const handleOptionPress = React.useCallback((option: Option) => {
    sync.sendMessage(props.sessionId, option.title);
  }, [props.sessionId]);

  const sourceText = props.message.displayText || props.message.text;

  // Calculate truncation for long messages
  const { text, needsTruncation, hiddenLines } = React.useMemo(() => {
    const lines = sourceText.split('\n');
    const needsTruncation = lines.length > LINE_THRESHOLD;

    if (needsTruncation && !expanded) {
      return {
        text: lines.slice(0, INITIAL_LINES).join('\n'),
        needsTruncation: true,
        hiddenLines: lines.length - INITIAL_LINES
      };
    }
    return { text: sourceText, needsTruncation, hiddenLines: 0 };
  }, [sourceText, expanded]);

  const handleToggle = React.useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  }, [expanded]);

  return (
    <View style={styles.userMessageContainer}>
      <View style={styles.userMessageBubble}>
        <MarkdownView markdown={text} onOptionPress={handleOptionPress} />
        {needsTruncation && (
          <Pressable
            onPress={handleToggle}
            style={styles.showMoreContainer}
            accessibilityRole="button"
            accessibilityLabel={expanded ? t('message.showLess') : t('message.showMore', { lines: hiddenLines })}
          >
            <Text style={styles.showMoreText}>
              {expanded
                ? t('message.showLess')
                : t('message.showMore', { lines: hiddenLines })}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function AgentTextBlock(props: {
  message: AgentTextMessage;
  sessionId: string;
}) {
  const [expanded, setExpanded] = React.useState(false);

  const handleOptionPress = React.useCallback((option: Option) => {
    sync.sendMessage(props.sessionId, option.title);
  }, [props.sessionId]);

  // Calculate truncation for long messages
  const { text, needsTruncation, hiddenLines } = React.useMemo(() => {
    const lines = props.message.text.split('\n');
    const needsTruncation = lines.length > LINE_THRESHOLD;

    if (needsTruncation && !expanded) {
      return {
        text: lines.slice(0, INITIAL_LINES).join('\n'),
        needsTruncation: true,
        hiddenLines: lines.length - INITIAL_LINES
      };
    }
    return { text: props.message.text, needsTruncation, hiddenLines: 0 };
  }, [props.message.text, expanded]);

  const handleToggle = React.useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  }, [expanded]);

  return (
    <View style={styles.agentMessageContainer}>
      <MarkdownView markdown={text} onOptionPress={handleOptionPress} />
      {needsTruncation && (
        <Pressable
          onPress={handleToggle}
          style={styles.showMoreContainer}
          accessibilityRole="button"
          accessibilityLabel={expanded ? t('message.showLess') : t('message.showMore', { lines: hiddenLines })}
        >
          <Text style={styles.showMoreText}>
            {expanded
              ? t('message.showLess')
              : t('message.showMore', { lines: hiddenLines })}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function AgentEventBlock(props: {
  event: AgentEvent;
  metadata: Metadata | null;
}) {
  if (props.event.type === 'switch') {
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>{t('message.switchedToMode', { mode: props.event.mode })}</Text>
      </View>
    );
  }
  if (props.event.type === 'message') {
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>{props.event.message}</Text>
      </View>
    );
  }
  if (props.event.type === 'limit-reached') {
    const formatTime = (timestamp: number): string => {
      try {
        const date = new Date(timestamp * 1000); // Convert from Unix timestamp
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch {
        return t('message.unknownTime');
      }
    };

    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>
          {t('message.usageLimitUntil', { time: formatTime(props.event.endsAt) })}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.agentEventContainer}>
      <Text style={styles.agentEventText}>{t('message.unknownEvent')}</Text>
    </View>
  );
}

function ToolCallBlock(props: {
  message: ToolCallMessage;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
}) {
  if (!props.message.tool) {
    return null;
  }
  return (
    <View style={styles.toolContainer}>
      <ToolView
        tool={props.message.tool}
        metadata={props.metadata}
        messages={props.message.children}
        sessionId={props.sessionId}
        messageId={props.message.id}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  messageContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  messageContent: {
    flexDirection: 'column',
    flexGrow: 1,
    flexBasis: 0,
    maxWidth: layout.maxWidth,
  },
  userMessageContainer: {
    maxWidth: '100%',
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  userMessageBubble: {
    backgroundColor: theme.colors.userMessageBackground,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
    maxWidth: '100%',
  },
  agentMessageContainer: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    alignSelf: 'flex-start',
  },
  agentEventContainer: {
    marginHorizontal: 8,
    alignItems: 'center',
    paddingVertical: 8,
  },
  agentEventText: {
    color: theme.colors.agentEventText,
    fontSize: 14,
  },
  toolContainer: {
    marginHorizontal: 8,
  },
  debugText: {
    color: theme.colors.agentEventText,
    fontSize: 12,
  },
  showMoreContainer: {
    paddingVertical: 8,
    alignItems: 'flex-start',
  },
  showMoreText: {
    color: theme.colors.textLink,
    fontSize: 14,
    fontWeight: '500',
  },
}));
