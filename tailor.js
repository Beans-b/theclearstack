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
      max_tokens: 1500,
      system: `You are a professional resume writer. Tailor the provided resume for the specific job. Rules:
- Rewrite the summary to mirror the job description language and priorities
- Elevate the most relevant bullets, reword to match JD language
- Trim irrelevant bullets
- Keep all dates, companies, contact info exactly as given
- No LinkedIn URL unless already present
- Output as clean plain text only — no markdown, no asterisks
- Use ALL CAPS for section headers
- Keep it tight, one page worth of content`,
      messages: [{
        role: 'user',
        content: `MASTER RESUME:
${resume}

JOB TITLE: ${job.title}
COMPANY: ${job.company}
JOB DESCRIPTION:
${job.jobDescription}

Output the tailored resume as plain text only.`
      }]
    })

    const tailored = message.content.map(b => b.text || '').join('')
    res.json({ tailored })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
