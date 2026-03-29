# LLM-Friendly DFA/NFA Generator

A modern dark-mode web app that parses DFA/NFA definitions from a strict, line-based format, renders a graph, and lets you test input acceptance.

## Supported line format

```text
state_name - flags - symbol(target) symbol2,symbol3(target)
```

Example:

```text
q0 - start - 1(q2) 0(qt)
q1 - accept - 1,0(q1)
qt - trap - 1,0(qt)
```

## Features

- Choose machine mode (DFA or NFA) before generation.
- Generate button placed directly beside the input controls.
- Acceptance test section to run an input string and get Accepted/Rejected result.
- AI Instruction button opens a modal with strict system-instruction text users can copy into model memory/custom instructions.
- Copy JSON is a single direct button above the JSON output.
- Robust parser with diagnostics for malformed lines, duplicate states, missing targets, and DFA-mode violations.
- Collision-aware graph layout with scaling controls and responsive viewport handling.

## Run

Open `index.html` directly in a browser.
