export function emailCodeSender(env: NodeJS.ProcessEnv = process.env) {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!key?.startsWith("re_") || !from) return null;

  return async (email: string, code: string) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: email, subject: "Your Overview Teams verification code",
        text: `Your Overview Teams verification code is ${code}. It expires in 5 minutes. If you didn’t request this code, you can ignore this email.` }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Delivery rejected");
  };
}
