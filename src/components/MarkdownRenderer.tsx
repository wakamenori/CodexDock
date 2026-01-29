import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import {
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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

type MermaidMode = "render" | "code";

type MermaidApi = {
  initialize: (config: {
    startOnLoad: boolean;
    securityLevel: string;
    theme?: string;
    themeVariables?: Record<string, string>;
  }) => void;
  render: (
    id: string,
    code: string,
  ) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
};

let mermaidInitialized = false;
let mermaidLoader: Promise<MermaidApi> | null = null;

const loadMermaid = async (): Promise<MermaidApi> => {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then((module) => {
      const api = (module.default ?? module) as MermaidApi;
      return api;
    });
  }
  const api = await mermaidLoader;
  if (!mermaidInitialized) {
    api.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: {
        background: "transparent",
        primaryColor: "#1a1b26",
        primaryTextColor: "#c0caf5",
        secondaryColor: "#16161e",
        tertiaryColor: "#0f111a",
        lineColor: "#7aa2f7",
        nodeBorder: "#414868",
        clusterBkg: "#16161e",
        clusterBorder: "#414868",
        edgeLabelBackground: "#0f111a",
        actorBkg: "#1f2335",
        actorBorder: "#6b7698",
        actorTextColor: "#c0caf5",
        noteBkg: "#1f2335",
        noteBorderColor: "#6b7698",
        noteTextColor: "#c0caf5",
        signalColor: "#7aa2f7",
        signalTextColor: "#c0caf5",
        labelBoxBkgColor: "#1f2335",
        labelBoxBorderColor: "#6b7698",
        activationBkgColor: "#1f2335",
        activationBorderColor: "#6b7698",
        fontFamily:
          '"IBM Plex Sans", "Inter", system-ui, -apple-system, sans-serif',
      },
    });
    mermaidInitialized = true;
  }
  return api;
};

const findCodeElement = (node: ReactNode): React.ReactElement | null => {
  if (!node) {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findCodeElement(child);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (isValidElement(node) && typeof node.type === "string") {
    if (node.type === "code") {
      return node;
    }
    if (node.props?.children) {
      return findCodeElement(node.props.children);
    }
  }
  return null;
};

const extractLanguage = (className?: string): string | null => {
  if (!className) {
    return null;
  }
  const match = className.match(/language-([^\s]+)/);
  return match?.[1]?.toLowerCase() ?? null;
};

type MermaidRendererProps = {
  code: string;
};

function MermaidRenderer({ code }: MermaidRendererProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindFunctionsRef = useRef<((element: Element) => void) | null>(null);
  const renderIdRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let cancelled = false;
    const trimmed = code.trim();
    if (!trimmed) {
      setSvg(null);
      setError("Mermaidコードが空です。");
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);
    setSvg(null);

    loadMermaid()
      .then((api) => api.render(renderIdRef.current, trimmed))
      .then((result) => {
        if (cancelled) {
          return;
        }
        bindFunctionsRef.current = result.bindFunctions ?? null;
        setSvg(result.svg);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setError("Mermaidの描画に失敗しました。");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!svg || !containerRef.current || !bindFunctionsRef.current) {
      return;
    }
    const bind = bindFunctionsRef.current;
    bindFunctionsRef.current = null;
    bind(containerRef.current);
  }, [svg]);

  if (loading) {
    return <div className="mermaid-render mermaid-loading">Rendering...</div>;
  }

  if (error) {
    return <div className="mermaid-render mermaid-error">{error}</div>;
  }

  if (!svg) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-render"
      // Mermaid renders SVG markup; sanitize via mermaid securityLevel=strict
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid renders SVG markup; strict mode mitigates XSS.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function CodeBlock({ children, ...props }: PreProps) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeElement = findCodeElement(children);
  const rawText = extractText(codeElement?.props?.children ?? children);
  const language = extractLanguage(codeElement?.props?.className);
  const isMermaid = language === "mermaid";
  const [mermaidMode, setMermaidMode] = useState<MermaidMode>("render");

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
      <div className="code-toolbar">
        {isMermaid && (
          <fieldset className="code-toggle" data-mode={mermaidMode}>
            <legend className="sr-only">Mermaid view</legend>
            <button
              type="button"
              aria-pressed={mermaidMode === "render"}
              data-active={mermaidMode === "render"}
              onClick={() => setMermaidMode("render")}
            >
              Render
            </button>
            <button
              type="button"
              aria-pressed={mermaidMode === "code"}
              data-active={mermaidMode === "code"}
              onClick={() => setMermaidMode("code")}
            >
              Code
            </button>
          </fieldset>
        )}
        <button
          type="button"
          className="code-copy"
          onClick={() => {
            void handleCopy();
          }}
          aria-label={copied ? "Copied" : "Copy code"}
          title={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
      {isMermaid && mermaidMode === "render" ? (
        <MermaidRenderer code={rawText} />
      ) : (
        <pre {...props}>{children}</pre>
      )}
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
