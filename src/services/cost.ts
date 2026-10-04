const COST_TABLE: Record<string, { in: number; out: number }> = {
  'gpt-4o':            { in: 0.000005,  out: 0.000015 },
  'gpt-4o-mini':       { in: 0.00000015, out: 0.0000006 },
  'gpt-4-turbo':       { in: 0.00001,   out: 0.00003 },
  'o1':                { in: 0.000015,  out: 0.00006 },
  'o1-mini':           { in: 0.000003,  out: 0.000012 },
  'claude-3-5-sonnet-20241022': { in: 0.000003, out: 0.000015 },
  'claude-3-5-haiku-20241022':  { in: 0.0000008, out: 0.000004 },
  'claude-3-opus-20240229':     { in: 0.000015,  out: 0.000075 },
  'gemini-2.5-pro':    { in: 0.00000125, out: 0.00001 },
  'gemini-2.5-flash':  { in: 0.0000003, out: 0.0000025 },
  'gemini-2.5-flash-lite': { in: 0.000000075, out: 0.0000003 },
  'gemini-1.5-pro':    { in: 0.00000125, out: 0.000005 },
  'gemini-1.5-flash':  { in: 0.000000075, out: 0.0000003 },
  'gemini-2.0-flash':  { in: 0.0000001,  out: 0.0000004 },
  'llama-3.3-70b-versatile': { in: 0.00000059, out: 0.00000079 },
  'llama-3.1-8b-instant':    { in: 0.00000005, out: 0.00000008 },
  'mixtral-8x7b-32768':      { in: 0.00000024, out: 0.00000024 },
  'gemma2-9b-it':            { in: 0.0000002,  out: 0.0000002  },
};

export function calcCost(model: string, inTokens: number, outTokens: number): number {
  const t = COST_TABLE[model];
  if (!t) return 0;
  return t.in * inTokens + t.out * outTokens;
}
