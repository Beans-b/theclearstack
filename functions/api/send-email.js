/**
 * ResumeAgent - AI-Powered Job Search
 * Copyright (c) 2025 Brian Burge. All rights reserved.
 * Unauthorized copying, modification, or distribution of this file,
 * via any medium, is strictly prohibited.
 * Proprietary and confidential.
 */
import nodemailer from 'nodemailer'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { to, subject, body, resume, company, gmailUser, gmailPass } = req.body

  if (!gmailUser || !gmailPass) {
    return res.status(400).json({ error: 'Gmail credentials required' })
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass }
  })

  const filename = `Resume_${company.replace(/\s+/g, '_')}.txt`

  try {
    await transporter.sendMail({
      from: `"${gmailUser}" <${gmailUser}>`,
      to,
      subject,
      text: body,
      attachments: [{
        filename,
        content: resume,
        contentType: 'text/plain'
      }]
    })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
