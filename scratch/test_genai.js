import { GoogleGenAI } from '@google/genai'
import dotenv from 'dotenv'
dotenv.config()

async function test() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: "hello",
    })
    console.log(response.text)
  } catch (err) {
    console.error("SDK Error Details:", err)
  }
}

test()
