import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

// 1. Patch react-draggable log utility to avoid ReferenceError: process is not defined in Vite
const rDraggablePaths = [
  path.join(root, "node_modules/react-draggable/build/cjs/chunk-RXGSR3JC.mjs"),
  path.join(root, "node_modules/react-draggable/build/cjs/cjs.js"),
];

for (const p of rDraggablePaths) {
  if (fs.existsSync(p)) {
    let content = fs.readFileSync(p, "utf-8");
    if (content.includes("if (process.env.DRAGGABLE_DEBUG)")) {
      content = content.replace(
        "if (process.env.DRAGGABLE_DEBUG)",
        'if (typeof process !== "undefined" && process.env && process.env.DRAGGABLE_DEBUG)'
      );
      fs.writeFileSync(p, content, "utf-8");
      console.log(`[patch-rgl] Patched ${p}`);
    }
  }
}

// 2. Patch react-grid-layout GridItem stale closure for dragging state
const rglPaths = [
  path.join(root, "node_modules/react-grid-layout/dist/chunk-WGL5FSZH.mjs"),
  path.join(root, "node_modules/react-grid-layout/dist/chunk-BPZQUJ7Y.js"),
];

for (const p of rglPaths) {
  if (fs.existsSync(p)) {
    let content = fs.readFileSync(p, "utf-8");
    if (content.includes("const [dragging, setDragging] =") && !content.includes("draggingRef")) {
      content = content.replace(
        /(const \[dragging, setDragging\] = React2\.useState\(false\);)/g,
        "$1\n  const draggingRef = React2.useRef(false);"
      );
      content = content.replace(
        /(const \[dragging, setDragging\] = useState\(false\);)/g,
        "$1\n  const draggingRef = useRef(false);"
      );

      content = content.replace(
        /setDragging\(true\);/g,
        "draggingRef.current = true;\n        setDragging(true);"
      );

      content = content.replace(
        /if \(!onDragProp \|\| !dragging\) return;/g,
        "if (!onDragProp || (!dragging && !draggingRef.current)) return;"
      );

      content = content.replace(
        /if \(!onDragStopProp \|\| !dragging\) return;/g,
        "if (!onDragStopProp || (!dragging && !draggingRef.current)) return;\n      draggingRef.current = false;"
      );

      fs.writeFileSync(p, content, "utf-8");
      console.log(`[patch-rgl] Patched ${p}`);
    }
  }
}
