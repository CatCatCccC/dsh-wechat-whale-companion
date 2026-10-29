import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatJournalBlock, pushTurn } from '../lib/core/chat-journal.js'

describe('chat journal', () => {
  it('pushes turns newest-first and caps', () => {
    let turns = []
    for (let i = 0; i < 12; i++) {
      turns = pushTurn(turns, { owner: `o${i}`, assistant: `a${i}`, limit: 5 })
    }
    assert.equal(turns.length, 5)
    assert.equal(turns[0].owner, 'o11')
    assert.equal(turns[0].n, 12)
  })

  it('formats inject block', () => {
    const turns = pushTurn([], { owner: '今天好累', assistant: '累了就睡' })
    const block = formatJournalBlock(turns, { maxLines: 8 })
    assert.match(block, /近期对话/)
    assert.match(block, /今天好累/)
    assert.match(block, /累了就睡/)
  })
})
