export const getUtcDate = (date: Date = new Date()): Date => {
  return new Date(date.toUTCString());
};

export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const formatShortDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};
