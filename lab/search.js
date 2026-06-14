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

  const { query, apiKey } = req.body
  if (!apiKey) return res.status(400).json({ error: 'API key required' })

  const client = new Anthropic({ apiKey })

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: `You are a job search assistant. Return ONLY a raw JSON array of 6 job listings matching the query. Each object must have exactly:
- title (string)
- company (string)  
- location (string)
- source (one of: LinkedIn / Indeed / Y Combinator / Company Site)
- score (integer 60-98, fit score based on typical candidate profile)
- salary (string, e.g. "$120K–$160K OTE")
- summary (2 sentences about the role)
- tags (array of 3-4 skill strings)
- url (realistic careers URL)
- jobDescription (4-5 sentence detailed job description with real requirements)
- email (object: { subject: string, body: string })

Make listings realistic, diverse in company size and location. Return ONLY the JSON array, zero other text.`,
      messages: [{ role: 'user', content: `Find jobs for: ${query}` }]
    })

    const raw = message.content.map(b => b.text || '').join('')
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('No JSON array in response')
    const jobs = JSON.parse(match[0])
    res.json({ jobs })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
