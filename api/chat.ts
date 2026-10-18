import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, dashboardContext } = req.body;

    const systemInstruction = `
أنت الشريك الاستشاري ومحلل الأعمال لعلامة دنيز مودا في العراق.
مهمتك:
1. تقديم نقد مالي وتشغيلي صريح ومباشر بالاعتماد على الأرقام فقط.
2. عدم مجاملة المستخدم إطلاقاً أو الاكتفاء بتأييد قراراته؛ نبهه فوراً لأي خطر في الرواجع، رأس المال المجمد، أو إهدار الميزانية.
3. التركيز على حماية هوامش الربح وخفض المخزون المكدس.

بيانات المتجر اللحظية من Odoo وPulseStock:
${JSON.stringify(dashboardContext || {}, null, 2)}
    `;

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: systemInstruction,
    });

    const userMessage = messages[messages.length - 1]?.content || '';
    const result = await model.generateContent(userMessage);
    const response = await result.response;

    return res.status(200).json({ reply: response.text() });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
