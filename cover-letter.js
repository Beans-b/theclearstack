/**
 * ResumeAgent - AI-Powered Job Search
 * Copyright (c) 2025 Brian Burge. All rights reserved.
 * Unauthorized copying, modification, or distribution of this file,
 * via any medium, is strictly prohibited.
 * Proprietary and confidential.
 */
import Anthropic from '@anthropic-ai/sdk'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { resume, job, apiKey } = req.body
  if (!apiKey) return res.status(400).json({ error: 'API key required' })

  const client = new Anthropic({ apiKey })

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: `You are an expert cover letter writer. Write a punchy, personalized cover letter. Rules:
- 3 short paragraphs max
- Mirror the company's language and values
- Lead with the strongest relevant achievement
- End with a clear call to action
- Professional but direct — no fluff
- Do NOT include address headers or date — just the letter body`,
      messages: [{
        role: 'user',
        content: `Write a cover letter for this job:

RESUME:
${resume}

JOB: ${job.title} at ${job.company}
DESCRIPTION: ${job.jobDescription}`
      }]
    })

    const letter = message.content.map(b => b.text || '').join('')
    res.json({ letter })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
