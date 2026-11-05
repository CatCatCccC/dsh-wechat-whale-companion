import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDiaryPrompt,
  craftDailyEntry,
  detectOwnerSleepAt,
  draftDiaryWithLlm,
  ensureSleepMention,
  filterTurnsForDay,
  formatDayTranscript,
  isOwnerSleepText,
  parseWriteAt,
  shanghaiDay,
  shouldWriteDaily,
} from '../lib/core/auto-diary.js'

describe('daily diary', () => {
  it('parses writeAt', () => {
    assert.deepEqual(parseWriteAt('22:00'), { hour: 22, minute: 0 })
    assert.deepEqual(parseWriteAt('9:30'), { hour: 9, minute: 30 })
  })

  it('detects owner goodnight text', () => {
    assert.equal(isOwnerSleepText('晚安'), true)
    assert.equal(isOwnerSleepText('我睡了哦'), true)
    assert.equal(isOwnerSleepText('不睡'), false)
    assert.equal(isOwnerSleepText('明天再说'), false)
  })

  it('gates once per day after writeAt; goodnight ignores clock', () => {
    // Construct a UTC instant that is 22:05 in Asia/Shanghai (UTC+8) on 2026-10-30
    const at2205 = Date.parse('2026-10-30T14:05:00.000Z')
    const day = shanghaiDay(at2205, 'Asia/Shanghai')
    assert.equal(day, '2026-10-30')
    assert.equal(
      shouldWriteDaily(at2205, {
        writeAt: '22:00',
        lastWrittenDay: '',
        timeZone: 'Asia/Shanghai',
      }).ok,
      true,
    )
    assert.equal(
      shouldWriteDaily(at2205, {
        writeAt: '22:00',
        lastWrittenDay: day,
        timeZone: 'Asia/Shanghai',
      }).ok,
      false,
    )
    const at2100 = Date.parse('2026-10-30T13:00:00.000Z')
    assert.equal(
      shouldWriteDaily(at2100, {
        writeAt: '22:00',
        lastWrittenDay: '',
        timeZone: 'Asia/Shanghai',
      }).reason,
      'too_early',
    )
    assert.equal(
      shouldWriteDaily(at2100, {
        lastWrittenDay: '',
        timeZone: 'Asia/Shanghai',
        ignoreClock: true,
      }).ok,
      true,
    )
    assert.equal(
      shouldWriteDaily(at2100, {
        writeAt: '',
        lastWrittenDay: '',
        timeZone: 'Asia/Shanghai',
      }).reason,
      'no_clock',
    )
  })

  it('filters turns for the day and crafts summary', () => {
    const day = '2026-10-30'
    const turns = [
      { at: Date.parse('2026-10-30T04:00:00.000Z'), owner: '今天好累', assistant: '靠一下' },
      { at: Date.parse('2026-10-29T04:00:00.000Z'), owner: '昨天的', assistant: '嗯' },
    ]
    const today = filterTurnsForDay(turns, day, 'Asia/Shanghai')
    assert.equal(today.length, 1)
    const text = craftDailyEntry({
      day,
      turns: today,
      moodWord: '还行',
      affinityWord: '挺熟',
    })
    assert.match(text, /2026-10-30/)
    assert.match(text, /今天好累/)
    assert.match(text, /1 轮/)
    assert.match(text, /跟主人挺熟/)
    assert.match(text, /黏着主人/)
    assert.doesNotMatch(text, /跟他|黏着他/)
  })

  it('writes a lonely day when no turns', () => {
    const text = craftDailyEntry({ day: '2026-10-30', turns: [], moodWord: '偏低落' })
    assert.match(text, /没跟主人说话/)
    assert.match(text, /希望主人明天还来/)
  })

  it('keeps more owner lines and drops tool noise', () => {
    const text = craftDailyEntry({
      day: '2026-11-04',
      turns: [
        { owner: '你好呀小鱼', assistant: '嗯' },
        { owner: '回一句带 || 的试试', assistant: 'a||b' },
        { owner: '要亲亲才能起床', assistant: '哼' },
        { owner: '起床了已经', assistant: '那行' },
        { owner: '还好呢', assistant: '那就好' },
      ],
      moodWord: '还行',
      affinityWord: '刚认识',
      shareHooks: ['晚安宝宝'],
    })
    assert.match(text, /主人说过/)
    assert.match(text, /要亲亲才能起床/)
    assert.match(text, /我也回过/)
    assert.match(text, /主动找主人提过：晚安宝宝/)
    assert.doesNotMatch(text, /\|\|/)
  })

  it('detects owner sleep clock and mentions it', () => {
    const at = Date.parse('2026-11-04T15:41:00.000Z') // 23:41 CST
    const turns = [
      { at: Date.parse('2026-11-04T04:00:00.000Z'), owner: '早', assistant: '嗯' },
      { at, owner: '晚安我睡了', assistant: '晚安' },
    ]
    assert.equal(detectOwnerSleepAt(turns, 'Asia/Shanghai'), '23:41')
    const text = craftDailyEntry({
      day: '2026-11-04',
      turns,
      sleepAt: '23:41',
      moodWord: '还行',
      affinityWord: '刚认识',
    })
    assert.match(text, /23:41/)
    assert.match(text, /主人大约 23:41 睡了/)
  })

  it('formats day transcript chronologically', () => {
    const turns = [
      { at: 2000, owner: '第二句', assistant: '回2' },
      { at: 1000, owner: '第一句', assistant: '回1' },
    ]
    const t = formatDayTranscript(turns, { timeZone: 'UTC' })
    assert.ok(t.indexOf('第一句') < t.indexOf('第二句'))
    assert.match(t, /主人：第一句/)
    assert.match(t, /我：回1/)
  })

  it('buildDiaryPrompt requires 主人 and sleep note', () => {
    const { system, user } = buildDiaryPrompt({
      day: '2026-11-04',
      sleepAt: '23:40',
      transcript: '[10:00] 主人：你好',
    })
    assert.match(system, /主人/)
    assert.match(system, /禁止用「他/)
    assert.match(user, /23:40/)
    assert.match(user, /必须写明/)
  })

  it('ensureSleepMention appends when missing', () => {
    assert.equal(
      ensureSleepMention('今天挺黏主人的。', '23:10'),
      '今天挺黏主人的。主人大约 23:10 睡了。',
    )
    assert.equal(
      ensureSleepMention('主人大约 23:10 睡了，开心。', '23:10'),
      '主人大约 23:10 睡了，开心。',
    )
  })

  it('draftDiaryWithLlm summarizes via stream', async () => {
    async function* stream() {
      yield {
        type: 'text-delta',
        text: '今天跟主人第一次正经打招呼，他还说要亲亲才肯起床，哼。主人大约 23:41 睡了。',
      }
      yield { type: 'finish', kind: 'stop' }
    }
    const ctx = {
      get(name) {
        if (name === 'llm') return { stream: () => stream() }
        if (name === 'agentDefaultModel') {
          return {
            currentSelection: () => ({
              provider: 'deepseek-official',
              model: 'flash',
            }),
          }
        }
        return undefined
      },
    }
    const r = await draftDiaryWithLlm({
      ctx,
      day: '2026-11-04',
      turns: [
        {
          at: Date.parse('2026-11-04T15:41:00.000Z'),
          owner: '晚安',
          assistant: '晚安',
        },
      ],
      sleepAt: '23:41',
      moodWord: '还行',
      affinityWord: '刚认识',
    })
    assert.equal(r.source, 'dsh-llm')
    assert.match(r.text, /主人/)
    assert.match(r.text, /23:41/)
  })
})
