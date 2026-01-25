export const formatTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const formatRelativeTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return value;

  const diffMs = Date.now() - time;
  if (diffMs < 0) return "now";

  const minutes = Math.floor(diffMs / 60000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return date.toLocaleDateString();
};
