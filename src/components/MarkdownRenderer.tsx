import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { copyToClipboard } from "../utils/clipboard";

type MarkdownRendererProps = {
  children: string;
};

const extractText = (node: ReactNode): string => {
  if (typeof node === "string") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  if (node && typeof node === "object" && "props" in node) {
    const element = node as { props?: { children?: ReactNode } };
    return extractText(element.props?.children ?? "");
  }
  return "";
};

type PreProps = React.HTMLAttributes<HTMLPreElement> & {
  children?: ReactNode;
};

function CodeBlock({ children, ...props }: PreProps) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rawText = extractText(children);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!rawText) {
      return;
    }
    const copiedText = await copyToClipboard(rawText);
    if (!copiedText) {
      return;
    }
    setCopied(true);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, [rawText]);

  return (
    <div className="code-block group">
      <pre {...props}>{children}</pre>
      <button
        type="button"
        className="code-copy"
        onClick={() => {
          void handleCopy();
        }}
        aria-label="Copy code"
        title="Copy code"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function MarkdownRenderer({ children }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
      components={{ pre: CodeBlock }}
    >
      {children}
    </ReactMarkdown>
  );
}
