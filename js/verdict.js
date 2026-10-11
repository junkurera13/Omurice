// Chef Okada's one-line verdict, shared by the result screen and the share card.
export function verdictQuote(score) {
  if (score > 90) return '“You start Monday. Bring your own chopsticks.”';
  if (score >= 85) return '“Close. Very close. Come back next week.”';
  if (score >= 70) return '“You can cook. That wasn’t this omelette, though.”';
  if (score >= 50) return '“We’ll keep your application on file.”';
  return '“Have you considered washing dishes?”';
}
