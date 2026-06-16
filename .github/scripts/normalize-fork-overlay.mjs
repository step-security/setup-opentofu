// Re-applies the fork's StepSecurity copyright line to each file's license
// header so it never surfaces as a sync conflict. Operates only on the leading
// comment block; body conflicts are left for a human.
// Usage: node normalize-fork-overlay.mjs <file> [<file> ...]

import { readFileSync, writeFileSync } from 'node:fs'

const FORK_COPYRIGHT = ' * Copyright (c) StepSecurity'

function normalizeHeader (src) {
  if (!src.startsWith('/**')) return src
  const end = src.indexOf('*/')
  if (end === -1) return src

  let header = src.slice(0, end + 2)
  const rest = src.slice(end + 2)

  // 1. Resolve conflict markers inside the header by taking OURS.
  header = header.replace(
    /^<<<<<<< ours\r?\n([\s\S]*?)^=======\r?\n[\s\S]*?^>>>>>>> theirs\r?\n/gm,
    '$1'
  )

  // 2. Ensure the StepSecurity copyright line is present.
  if (!/Copyright \(c\) StepSecurity/.test(header)) {
    const lines = header.split('\n')
    let lastCopyright = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\*\s*Copyright \(c\)/.test(lines[i])) lastCopyright = i
    }
    if (lastCopyright !== -1) {
      lines.splice(lastCopyright + 1, 0, FORK_COPYRIGHT)
      header = lines.join('\n')
    }
  }

  return header + rest
}

const files = process.argv.slice(2)
let changed = 0
for (const file of files) {
  let before
  try {
    before = readFileSync(file, 'utf8')
  } catch {
    continue // file may not exist (e.g. deleted upstream); skip
  }
  const after = normalizeHeader(before)
  if (after !== before) {
    writeFileSync(file, after)
    console.log(`normalized header: ${file}`)
    changed++
  }
}
console.log(`fork-overlay normalize: ${changed} file(s) updated`)
