import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DropdownSelect } from "../src/components/DropdownSelect.js";
import "../src/styles/index.css";

function Showcase() {
  const [value, setValue] = useState(1);
  const dialog = useRef<HTMLDialogElement>(null);
  const mode = new URLSearchParams(location.search).get("mode");
  useEffect(() => {
    if (mode === "dialog") dialog.current?.showModal();
  }, [mode]);

  const controls = (
    <>
      <DropdownSelect
        label="Long options"
        value={value}
        onChange={setValue}
        options={Array.from({ length: 50 }, (_, index) => ({
          value: index + 1,
          label: `Choice ${String(index + 1).padStart(2, "0")}`,
          disabled: index === 1,
        }))}
      />
      <DropdownSelect
        label="Disabled choice"
        value="alpha"
        onChange={() => {}}
        disabled
        options={[{ value: "alpha", label: "Alpha" }]}
      />
      <button type="button">After dropdowns</button>
      <output aria-label="Selected value">{value}</output>
    </>
  );
  return mode === "dialog" ? (
    <dialog ref={dialog} aria-label="Dropdown dialog" style={{ width: "260px", padding: "16px" }}>
      {controls}
    </dialog>
  ) : (
    <main style={{ padding: "16px" }}>{controls}</main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Dropdown fixture root is missing.");
createRoot(root).render(<Showcase />);
