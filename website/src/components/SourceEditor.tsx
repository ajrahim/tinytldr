import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { liquid } from "@codemirror/lang-liquid";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import type { SiteThemeMode } from "../hooks/useThemeMode.js";

export function SourceEditor({
  language,
  value,
  onChange,
  disabled,
  themeMode,
}: {
  language: "html" | "css" | "json";
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  themeMode: SiteThemeMode;
}) {
  const extensions = useMemo(
    () => [
      language === "html" ? liquid() : language === "css" ? css() : json(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": `Template ${language.toUpperCase()}`,
        "aria-multiline": "true",
        spellcheck: "false",
      }),
    ],
    [language],
  );

  return (
    <section className="source-editor" aria-label={`${language.toUpperCase()} editor`}>
      <h2>{language.toUpperCase()}</h2>
      <CodeMirror
        className="source-editor-code"
        value={value}
        extensions={extensions}
        onChange={onChange}
        theme={themeMode}
        editable={!disabled}
        readOnly={disabled}
        height="100%"
        indentWithTab={false}
        basicSetup={{
          foldGutter: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
        }}
      />
    </section>
  );
}
