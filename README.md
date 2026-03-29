# LLM-Friendly DFA/NFA Generator

A lightweight dark-mode web app that parses DFA/NFA definitions from a strict, LLM-friendly text format and renders an interactive graph.

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

- Side-by-side layout: input and diagnostics on the left, graph and JSON on the right.
- Robust parser with diagnostics for malformed lines, duplicate states, and missing targets.
- Automatic implicit state creation for referenced-but-undefined targets.
- Machine JSON output suitable for LLM/tool pipelines.
- Reusable prompt/memory instruction that nudges LLMs to keep this strict textual format.
- Collision-aware graph layout with scaling controls and responsive overflow handling.

## Run

Open `index.html` directly in a browser.
