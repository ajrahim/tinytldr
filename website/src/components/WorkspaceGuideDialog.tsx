import { useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  LayoutTemplate,
  Lock,
  Sparkles,
} from "lucide-react";
import { HOSTED_MCP_URL } from "../lib/McpSnippetBuilder.js";
import { CodeSnippetBox } from "./CodeSnippetBox.js";
import { Dialog } from "./Dialog.js";
import { GitHubBadge } from "./GitHubBadge.js";

export type WorkspaceGuideTopic = "welcome" | "mcp" | "docs";
export const WELCOME_STORAGE_KEY = "tinytldr:welcome:v1";

const welcomeSlides = [
  {
    id: "templates",
    label: "Templates",
    title: ["Templates built", "for agents."],
    description: "Your agent brings the words. Our templates take care of the visuals.",
  },
  {
    id: "consistency",
    label: "Consistency",
    title: ["Made to be", "consistent"],
    description: "Reuse layouts, colors, and typography to keep every page on brand.",
  },
  {
    id: "byok",
    label: "Your key",
    title: ["Bring your", "own key"],
    description: "Use your own key for optional AI drafting. Templates work without it.",
  },
] as const;

type WelcomeSlideId = (typeof welcomeSlides)[number]["id"];

function WelcomeArtwork({ slideId }: { slideId: WelcomeSlideId }) {
  if (slideId === "templates") {
    return (
      <>
        <div className="welcome-piece welcome-card welcome-agent">
          <span className="welcome-art-label">
            <Sparkles /> Agent
          </span>
          <p className="welcome-agent-quote">&ldquo;Less, but better.&rdquo;</p>
          <ul className="welcome-agent-list">
            <li>Hook</li>
            <li>3 points</li>
            <li>CTA</li>
          </ul>
        </div>
        <ArrowRight className="welcome-piece welcome-art-arrow" />
        <div className="welcome-piece welcome-card welcome-slots">
          <span className="welcome-art-label">Template</span>
          <i className="welcome-slot is-title" />
          <i className="welcome-slot" />
          <i className="welcome-slot" />
          <i className="welcome-slot is-short" />
        </div>
        <ArrowRight className="welcome-piece welcome-art-arrow" />
        <div className="welcome-piece welcome-card welcome-post">
          <span className="welcome-art-label">Post</span>
          <i className="welcome-post-accent" />
          <strong>Less, but better.</strong>
          <div className="welcome-post-lines">
            <i />
            <i />
            <i />
          </div>
          <span className="welcome-art-caption">@you</span>
        </div>
      </>
    );
  }

  if (slideId === "consistency") {
    return (
      <>
        {[
          ["01", "Plan."],
          ["02", "Build."],
          ["03", "Ship."],
        ].map(([number, word]) => (
          <div key={number} className="welcome-piece welcome-card welcome-page">
            <i className="welcome-post-accent" />
            <span className="welcome-art-label">{number}</span>
            <strong>{word}</strong>
            <div className="welcome-post-lines">
              <i />
              <i />
            </div>
            <span className="welcome-art-caption">@brand</span>
          </div>
        ))}
        <div className="welcome-piece welcome-style-strip">
          <span className="welcome-swatches">
            <i />
            <i />
            <i />
          </span>
          <b>Aa</b>
          <LayoutTemplate />
          <span className="welcome-art-label">Shared style</span>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="welcome-piece welcome-card welcome-key-panel">
        <span className="welcome-key-header">
          <span className="welcome-art-label">
            <KeyRound /> AI drafting
          </span>
          <span className="welcome-key-tag">Optional</span>
        </span>
        {[
          { label: "Provider", value: "Your provider", Icon: ChevronDown },
          { label: "API key", value: "sk-\u2022\u2022\u2022\u20224f2a", Icon: Lock },
          { label: "Model", value: "From your API", Icon: ChevronDown },
        ].map(({ label, value, Icon }) => (
          <span key={label} className="welcome-key-field">
            <span className="welcome-art-caption">{label}</span>
            <span className="welcome-key-value">
              {value}
              <Icon />
            </span>
          </span>
        ))}
      </div>
      <div className="welcome-piece welcome-card welcome-post welcome-key-template">
        <span className="welcome-art-label">Templates</span>
        <Check className="welcome-key-check" />
        <strong>No key needed.</strong>
      </div>
    </>
  );
}

export function WorkspaceGuideDialog({
  topic,
  onTopicChange,
  onClose,
  children,
}: {
  topic: WorkspaceGuideTopic;
  onTopicChange: (topic: WorkspaceGuideTopic) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const startButton = useRef<HTMLButtonElement>(null);
  const [welcomeSlide, setWelcomeSlide] = useState<(typeof welcomeSlides)[number]>(
    welcomeSlides[0],
  );
  const welcomeSlideId = useId();
  const welcomeSlideIndex = welcomeSlides.indexOf(welcomeSlide);
  const title =
    topic === "welcome" ? "tinytldr." : topic === "mcp" ? "Bring your agent." : "Documentation";

  return (
    <Dialog
      className={`workspace-guide${topic === "welcome" ? " is-welcome" : ""}${topic === "docs" ? " is-documentation" : ""}`}
      size={topic === "docs" ? "wide" : "standard"}
      title={title}
      ariaLabel={topic === "welcome" ? "Welcome to tinytldr." : undefined}
      description={
        topic === "welcome"
          ? undefined
          : topic === "mcp"
            ? "One URL. Sign in with your tinytldr account."
            : "Guides for authoring, rendering, and working with your agent."
      }
      initialFocus={startButton}
      closeLabel="Close guide"
      onClose={onClose}
      headerActions={topic === "welcome" ? <GitHubBadge /> : undefined}
      footer={
        topic === "welcome" ? (
          <>
            <div className="welcome-carousel-controls">
              <button
                type="button"
                className="welcome-carousel-arrow"
                aria-label="Previous slide"
                aria-controls={welcomeSlideId}
                onClick={() =>
                  setWelcomeSlide((current) => {
                    if (current.id === "templates") return welcomeSlides[2];
                    if (current.id === "consistency") return welcomeSlides[0];
                    return welcomeSlides[1];
                  })
                }
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="welcome-carousel-arrow"
                aria-label="Next slide"
                aria-controls={welcomeSlideId}
                onClick={() =>
                  setWelcomeSlide((current) => {
                    if (current.id === "templates") return welcomeSlides[1];
                    if (current.id === "consistency") return welcomeSlides[2];
                    return welcomeSlides[0];
                  })
                }
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
            <button ref={startButton} className="primary-button" type="button" onClick={onClose}>
              Start Creating
            </button>
            <p className="welcome-draft-note">
              Start without an account. Drafts stay in this browser.
              <br />
              Sign in to claim your designs.
            </p>
          </>
        ) : topic === "mcp" ? (
          <>
            <button className="dialog-secondary-button" type="button" onClick={onClose}>
              Close
            </button>
            <button className="primary-button" type="button" onClick={() => onTopicChange("docs")}>
              Read the documentation
            </button>
          </>
        ) : (
          <button className="dialog-secondary-button" type="button" onClick={onClose}>
            Close
          </button>
        )
      }
    >
      {topic === "welcome" ? (
        <div
          className="welcome-carousel"
          role="region"
          aria-roledescription="carousel"
          aria-label="About tinytldr"
        >
          <div
            className="welcome-hero"
            id={welcomeSlideId}
            role="group"
            aria-roledescription="slide"
            aria-label={`${welcomeSlideIndex + 1} of ${welcomeSlides.length}: ${welcomeSlide.label}`}
          >
            <div
              key={welcomeSlide.id}
              className={`welcome-artwork is-${welcomeSlide.id}`}
              aria-hidden="true"
            >
              <div className="welcome-art-stage">
                <WelcomeArtwork slideId={welcomeSlide.id} />
              </div>
            </div>
            <div className="welcome-copy" aria-live="polite" aria-atomic="true">
              <h3 key={welcomeSlide.id} className="welcome-headline">
                <span>{welcomeSlide.title[0]}</span> <span>{welcomeSlide.title[1]}</span>
              </h3>
              <p key={`${welcomeSlide.id}-description`} className="welcome-description">
                {welcomeSlide.description}
              </p>
            </div>
          </div>
        </div>
      ) : topic === "mcp" ? (
        <>
          <p>
            Add tinytldr's hosted MCP server to your agent. Your agent writes the copy; tinytldr
            renders it.
          </p>
          <div className="guide-server-url">
            <CodeSnippetBox title="Server URL" badge="HTTP" code={HOSTED_MCP_URL} compact />
          </div>
          <p className="guide-hint">
            The first time your agent connects, it opens a tinytldr sign-in page. Client setup
            commands and local <code>npx tinytldr mcp</code> setup are in the documentation.
          </p>
        </>
      ) : (
        children
      )}
    </Dialog>
  );
}
