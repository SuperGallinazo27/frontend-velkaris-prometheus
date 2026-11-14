export function estimateBudget(
  days: number,
  people: number,
  dailyRate: number,
  logistics: number,
  contingency: number,
) {
  if (
    ![days, people, dailyRate, logistics, contingency].every(Number.isFinite) ||
    days < 1 ||
    people < 1 ||
    dailyRate < 0 ||
    logistics < 0 ||
    contingency < 0
  )
    throw new Error("Presupuesto inválido");
  const fieldwork = days * people * dailyRate;
  const reserve = ((fieldwork + logistics) * contingency) / 100;
  return {
    fieldwork,
    logistics,
    reserve,
    total: fieldwork + logistics + reserve,
  };
}
