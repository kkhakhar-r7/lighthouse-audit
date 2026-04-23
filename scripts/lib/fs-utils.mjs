import fs from 'fs';

export const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

export const readHistoryFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const appendHistory = (filePath, entry) => {
  const history = readHistoryFile(filePath);
  history.push(entry);
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
  return history;
};
