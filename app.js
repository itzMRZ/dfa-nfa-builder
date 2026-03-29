const machineInput = document.getElementById('machineInput');
const machineMode = document.getElementById('machineMode');
const testInput = document.getElementById('testInput');
const testResult = document.getElementById('testResult');
const runTestBtn = document.getElementById('runTestBtn');
const parseBtn = document.getElementById('parseBtn');
const loadSampleBtn = document.getElementById('loadSampleBtn');
const openInstructionBtn = document.getElementById('openInstructionBtn');
const closeInstructionBtn = document.getElementById('closeInstructionBtn');
const instructionModal = document.getElementById('instructionModal');
const messages = document.getElementById('messages');
const jsonOutput = document.getElementById('jsonOutput');
const promptOutput = document.getElementById('promptOutput');
const copyJsonBtn = document.getElementById('copyJsonBtn');
const copyPromptBtn = document.getElementById('copyPromptBtn');
const graphSvg = document.getElementById('graphSvg');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const resetViewBtn = document.getElementById('resetViewBtn');

const SAMPLE = `q0 - start - 1(q2) 0(qt)
q1 - accept - 1,0(q1)
q2 - normal - 0(q1) 1(q2)
qt - trap - 1,0(qt)`;

const state = { scale: 1, machine: null };

function addMessage(level, text) {
  const line = document.createElement('div');
  line.className = `msg-${level}`;
  line.textContent = text;
  messages.appendChild(line);
}

function setTestResult(kind, text) {
  testResult.className = `test-result ${kind}`;
  testResult.textContent = text;
}

function clearMessages() {
  messages.innerHTML = '';
}

function parseFlags(flagChunk) {
  if (!flagChunk.trim()) return [];
  return flagChunk
    .split(',')
    .flatMap((x) => x.split(' '))
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function parseTransitions(transitionChunk, lineNo) {
  const parts = transitionChunk.trim().split(/\s+/).filter(Boolean);
  const transitions = [];
  const errors = [];

  for (const part of parts) {
    const match = part.match(/^([^()]+)\(([^()]+)\)$/);
    if (!match) {
      errors.push(`Line ${lineNo}: invalid transition token "${part}".`);
      continue;
    }
    const rawSymbols = match[1].split(',').map((s) => s.trim()).filter(Boolean);
    const target = match[2].trim();

    if (!target) {
      errors.push(`Line ${lineNo}: missing target in "${part}".`);
      continue;
    }
    if (rawSymbols.length === 0) {
      errors.push(`Line ${lineNo}: no symbols in "${part}".`);
      continue;
    }

    rawSymbols.forEach((symbol) => transitions.push({ symbol, target }));
  }

  return { transitions, errors };
}

function parseMachine(rawText, requestedMode) {
  const lines = rawText
    .split('\n')
    .map((line, idx) => ({ original: line, lineNo: idx + 1 }))
    .filter((item) => item.original.trim() && !item.original.trim().startsWith('#'));

  const map = new Map();
  const diagnostics = { errors: [], warnings: [], infos: [] };

  if (lines.length === 0) {
    diagnostics.errors.push('Input is empty. Add at least one state line.');
    return { diagnostics };
  }

  for (const { original, lineNo } of lines) {
    const chunks = original.split('-').map((c) => c.trim());
    if (chunks.length < 3) {
      diagnostics.errors.push(`Line ${lineNo}: expected 3 sections split by "-".`);
      continue;
    }

    const [name, flagChunk, ...transitionParts] = chunks;
    if (!name) {
      diagnostics.errors.push(`Line ${lineNo}: missing state name.`);
      continue;
    }
    if (map.has(name)) {
      diagnostics.errors.push(`Line ${lineNo}: duplicate state definition "${name}".`);
      continue;
    }

    const flags = parseFlags(flagChunk);
    const parsedTransitions = parseTransitions(transitionParts.join('-'), lineNo);
    diagnostics.errors.push(...parsedTransitions.errors);

    map.set(name, {
      id: name,
      flags,
      transitions: parsedTransitions.transitions,
      lineNo,
    });
  }

  if (diagnostics.errors.length > 0) return { diagnostics };

  const states = Array.from(map.values());
  const stateNames = new Set(states.map((s) => s.id));

  for (const s of states) {
    for (const tr of s.transitions) {
      if (!stateNames.has(tr.target)) {
        diagnostics.warnings.push(`State "${s.id}" references unknown target "${tr.target}"; creating implicit node.`);
      }
    }
  }

  const missingTargets = new Set(
    states.flatMap((s) => s.transitions.map((t) => t.target)).filter((t) => !stateNames.has(t)),
  );

  for (const missing of missingTargets) {
    states.push({ id: missing, flags: ['implicit'], transitions: [], lineNo: null });
    stateNames.add(missing);
  }

  const startStates = states.filter((s) => s.flags.includes('start')).map((s) => s.id);
  const acceptStates = states.filter((s) => s.flags.includes('accept') || s.flags.includes('final')).map((s) => s.id);

  if (startStates.length === 0) diagnostics.warnings.push('No start state marked. Add "start" flag for at least one state.');
  if (startStates.length > 1 && requestedMode === 'DFA') {
    diagnostics.errors.push('DFA mode selected but multiple start states found. Use NFA mode or one start state.');
  }

  const seen = new Set();
  for (const s of states) {
    const outgoingBySymbol = new Map();
    for (const tr of s.transitions) {
      const key = `${s.id}|${tr.symbol}|${tr.target}`;
      if (seen.has(key)) diagnostics.warnings.push(`Duplicate transition ${s.id} --${tr.symbol}--> ${tr.target}.`);
      seen.add(key);

      const symbolTargets = outgoingBySymbol.get(tr.symbol) || new Set();
      symbolTargets.add(tr.target);
      outgoingBySymbol.set(tr.symbol, symbolTargets);
    }

    if (requestedMode === 'DFA') {
      for (const [symbol, targets] of outgoingBySymbol.entries()) {
        if (targets.size > 1) {
          diagnostics.errors.push(`DFA mode violation at state "${s.id}": symbol "${symbol}" has multiple targets.`);
        }
      }
    }
  }

  if (diagnostics.errors.length > 0) return { diagnostics };

  const alphabet = [...new Set(states.flatMap((s) => s.transitions.map((t) => t.symbol)))].sort();

  const model = {
    type: requestedMode,
    states: states.map((s) => ({ id: s.id, flags: s.flags })),
    start_states: startStates,
    accept_states: acceptStates,
    alphabet,
    transitions: states.flatMap((s) => s.transitions.map((tr) => ({ from: s.id, symbol: tr.symbol, to: tr.target }))),
    meta: {
      total_states: states.length,
      total_transitions: states.reduce((acc, cur) => acc + cur.transitions.length, 0),
      requested_mode: requestedMode,
    },
  };

  return { model, diagnostics };
}

function buildMemoryInstruction() {
  return `SYSTEM INSTRUCTION: DFA/NFA STRICT FORMAT

Use this exact grammar:
Format: id - type - transitions

Definitions:
- id: unique state identifier (example: q0, q1, qt)
- type: one of start, accept, trap, normal
- transitions: transition tokens separated by spaces

Transition rules:
- 1(q2) means input 1 goes to q2
- 0,1(q1) means grouped inputs 0 and 1 both go to q1
- each token must be symbol_list(target_state)
- each referenced target_state must exist as its own state line

Hard constraints:
1) Exactly one state per line.
2) Exactly two " - " separators per line: id - type - transitions.
3) Do not output ASCII art, tables, markdown diagrams, or prose transitions.
4) Keep state names consistent and case-sensitive.
5) For DFA requests: one start state and max one target per symbol from each state.
6) For NFA requests: multiple start states / branching targets are allowed.
7) Include trap states explicitly when needed.

Example:
q0 - start - 1(q2) 0(qt)
q1 - accept - 0,1(q1)
qt - trap - 0,1(qt)`;
}

function createLayout(machine) {
  const nodes = machine.states.map((s) => ({ ...s }));
  const n = Math.max(nodes.length, 1);
  const cols = Math.ceil(Math.sqrt(n));
  const spacing = Math.max(110, 720 / Math.sqrt(n));

  nodes.forEach((node, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    node.x = 120 + col * spacing;
    node.y = 120 + row * spacing;
  });

  const minDist = Math.max(70, spacing * 0.6);
  for (let pass = 0; pass < 120; pass += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          dx /= dist;
          dy /= dist;
          a.x -= dx * push;
          a.y -= dy * push;
          b.x += dx * push;
          b.y += dy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  return nodes;
}

function renderGraph(machine) {
  graphSvg.innerHTML = '';
  if (!machine || machine.states.length === 0) return;

  const nodes = createLayout(machine);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const radius = Math.max(22, Math.min(34, 55 - Math.log(machine.states.length + 1) * 7));

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#9db3ff"></path>
    </marker>`;
  graphSvg.appendChild(defs);

  const edgesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  edgesGroup.setAttribute('stroke', '#9db3ff');
  edgesGroup.setAttribute('fill', 'none');
  edgesGroup.setAttribute('stroke-width', '1.7');

  const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  const edgeGroups = new Map();
  for (const edge of machine.transitions) {
    const key = `${edge.from}|${edge.to}`;
    const symbols = edgeGroups.get(key) || [];
    symbols.push(edge.symbol);
    edgeGroups.set(key, symbols);
  }

  edgeGroups.forEach((symbols, key) => {
    const [from, to] = key.split('|');
    const source = nodeMap.get(from);
    const target = nodeMap.get(to);
    if (!source || !target) return;

    const labelText = [...new Set(symbols)].join(',');

    if (source.id === target.id) {
      const loop = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = `M ${source.x} ${source.y - radius} C ${source.x + radius * 1.4} ${source.y - radius * 2.6}, ${source.x - radius * 1.4} ${source.y - radius * 2.6}, ${source.x} ${source.y - radius}`;
      loop.setAttribute('d', d);
      loop.setAttribute('marker-end', 'url(#arrow)');
      edgesGroup.appendChild(loop);

      const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      labelBg.setAttribute('x', `${source.x - 18}`);
      labelBg.setAttribute('y', `${source.y - radius * 2.45}`);
      labelBg.setAttribute('width', `${Math.max(36, labelText.length * 7)}`);
      labelBg.setAttribute('height', '16');
      labelBg.setAttribute('rx', '4');
      labelBg.setAttribute('fill', '#0d1320');
      labelBg.setAttribute('opacity', '0.82');
      edgesGroup.appendChild(labelBg);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', `${source.x}`);
      label.setAttribute('y', `${source.y - radius * 2.2}`);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#e7efff');
      label.setAttribute('font-size', '12');
      label.textContent = labelText;
      edgesGroup.appendChild(label);
      return;
    }

    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.hypot(dx, dy);
    const ux = dx / dist;
    const uy = dy / dist;

    const x1 = source.x + ux * radius;
    const y1 = source.y + uy * radius;
    const x2 = target.x - ux * radius;
    const y2 = target.y - uy * radius;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', `${x1}`);
    line.setAttribute('y1', `${y1}`);
    line.setAttribute('x2', `${x2}`);
    line.setAttribute('y2', `${y2}`);
    line.setAttribute('marker-end', 'url(#arrow)');
    edgesGroup.appendChild(line);

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2 - 10;

    const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const bgWidth = Math.max(24, labelText.length * 7.1);
    labelBg.setAttribute('x', `${midX - bgWidth / 2}`);
    labelBg.setAttribute('y', `${midY - 11}`);
    labelBg.setAttribute('width', `${bgWidth}`);
    labelBg.setAttribute('height', '16');
    labelBg.setAttribute('rx', '4');
    labelBg.setAttribute('fill', '#0d1320');
    labelBg.setAttribute('opacity', '0.84');
    edgesGroup.appendChild(labelBg);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', `${midX}`);
    label.setAttribute('y', `${midY}`);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', '#e7efff');
    label.setAttribute('font-size', '12');
    label.textContent = labelText;
    edgesGroup.appendChild(label);
  });

  graphSvg.appendChild(edgesGroup);

  nodes.forEach((node) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const isAccept = node.flags.includes('accept') || node.flags.includes('final');
    const isStart = node.flags.includes('start');
    const isTrap = node.flags.includes('trap');

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', `${node.x}`);
    circle.setAttribute('cy', `${node.y}`);
    circle.setAttribute('r', `${radius}`);
    circle.setAttribute('fill', isTrap ? '#291a24' : '#1f2a40');
    circle.setAttribute('stroke', isStart ? '#8ce4a3' : '#7b96d8');
    circle.setAttribute('stroke-width', '2');
    g.appendChild(circle);

    if (isAccept) {
      const inner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      inner.setAttribute('cx', `${node.x}`);
      inner.setAttribute('cy', `${node.y}`);
      inner.setAttribute('r', `${radius - 6}`);
      inner.setAttribute('fill', 'none');
      inner.setAttribute('stroke', '#96acf0');
      inner.setAttribute('stroke-width', '1.5');
      g.appendChild(inner);
    }

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', `${node.x}`);
    text.setAttribute('y', `${node.y + 4}`);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#e8eeff');
    text.setAttribute('font-size', '13');
    text.textContent = node.id;
    g.appendChild(text);

    nodeGroup.appendChild(g);
  });

  graphSvg.appendChild(nodeGroup);

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - 120;
  const maxX = Math.max(...xs) + 120;
  const minY = Math.min(...ys) - 140;
  const maxY = Math.max(...ys) + 120;

  graphSvg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
  graphSvg.style.transform = `scale(${state.scale})`;
}

function runInputTest() {
  if (!state.machine) {
    setTestResult('warn', 'Generate a valid machine before testing.');
    return;
  }

  const symbols = testInput.value.trim().split('').filter(Boolean);
  const alphabet = new Set(state.machine.alphabet);
  const badSymbol = symbols.find((s) => !alphabet.has(s));
  if (badSymbol) {
    setTestResult('warn', `Input contains symbol "${badSymbol}" not found in machine alphabet.`);
    return;
  }

  const transitionsByState = new Map();
  for (const t of state.machine.transitions) {
    const arr = transitionsByState.get(t.from) || [];
    arr.push(t);
    transitionsByState.set(t.from, arr);
  }

  let currentStates = new Set(state.machine.start_states);
  if (currentStates.size === 0) {
    setTestResult('warn', 'No start state found in machine.');
    return;
  }

  for (const symbol of symbols) {
    const next = new Set();
    for (const st of currentStates) {
      const outgoing = transitionsByState.get(st) || [];
      for (const tr of outgoing) {
        if (tr.symbol === symbol) next.add(tr.to);
      }
    }
    currentStates = next;
    if (currentStates.size === 0) break;
  }

  const accepts = new Set(state.machine.accept_states);
  const accepted = [...currentStates].some((s) => accepts.has(s));
  setTestResult(accepted ? 'accept' : 'reject', accepted ? 'Accepted' : 'Rejected');
}

function renderParseResult(result) {
  clearMessages();
  setTestResult('warn', 'Generate machine and test an input string.');

  if (result.diagnostics.errors.length > 0) {
    result.diagnostics.errors.forEach((m) => addMessage('err', m));
    jsonOutput.textContent = 'Cannot generate JSON due to errors.';
    promptOutput.textContent = buildMemoryInstruction();
    state.machine = null;
    renderGraph(null);
    return;
  }

  result.diagnostics.warnings.forEach((m) => addMessage('warn', m));
  result.diagnostics.infos.forEach((m) => addMessage('ok', m));
  if (result.diagnostics.warnings.length === 0 && result.diagnostics.infos.length === 0) {
    addMessage('ok', 'Machine parsed successfully with no warnings.');
  }

  state.machine = result.model;
  jsonOutput.textContent = JSON.stringify(result.model, null, 2);
  promptOutput.textContent = buildMemoryInstruction();
  renderGraph(result.model);
}

async function copyText(content, label) {
  try {
    await navigator.clipboard.writeText(content);
    addMessage('ok', `${label} copied to clipboard.`);
  } catch {
    addMessage('warn', `Could not copy ${label}. Browser clipboard permission denied.`);
  }
}

parseBtn.addEventListener('click', () => {
  renderParseResult(parseMachine(machineInput.value, machineMode.value));
});

loadSampleBtn.addEventListener('click', () => {
  machineInput.value = SAMPLE;
  renderParseResult(parseMachine(machineInput.value, machineMode.value));
});

runTestBtn.addEventListener('click', runInputTest);

copyJsonBtn.addEventListener('click', () => copyText(jsonOutput.textContent, 'JSON'));
copyPromptBtn.addEventListener('click', () => copyText(promptOutput.textContent, 'instruction'));

openInstructionBtn.addEventListener('click', () => instructionModal.showModal());
closeInstructionBtn.addEventListener('click', () => instructionModal.close());
instructionModal.addEventListener('click', (event) => {
  const rect = instructionModal.getBoundingClientRect();
  const inDialog = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inDialog) instructionModal.close();
});

zoomInBtn.addEventListener('click', () => {
  state.scale = Math.min(2.5, state.scale + 0.15);
  graphSvg.style.transform = `scale(${state.scale})`;
});
zoomOutBtn.addEventListener('click', () => {
  state.scale = Math.max(0.55, state.scale - 0.15);
  graphSvg.style.transform = `scale(${state.scale})`;
});
resetViewBtn.addEventListener('click', () => {
  state.scale = 1;
  graphSvg.style.transform = 'scale(1)';
});

machineInput.value = SAMPLE;
promptOutput.textContent = buildMemoryInstruction();
renderParseResult(parseMachine(SAMPLE, machineMode.value));
