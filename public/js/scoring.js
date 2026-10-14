// Правила начисления очков в «Тарелочках». Один файл и для игры (браузер), и для сервера,
// который по этим же правилам отсекает невозможные результаты в таблице лидеров.
//
// Попадание: 10 + до 5 за дальность + надбавка за трудную траекторию (заяц, сверху, из-за спины…).
// Серия (попадания подряд без промахов и упущенных тарелок): каждое следующее попадание
//   даёт ещё +3, максимум +15 к одному попаданию.
// Каждые 5 попаданий подряд — бонус серии: 5 × длина серии (5 → +25, 10 → +50, 15 → +75 …).
// Без промахов — все тарелки раунда сбиты и ни одного лишнего выстрела: +250.

export const RULES = {
  base: 10,
  distance: 5,
  streakStep: 3,
  streakMax: 15,
  milestoneEvery: 5,
  milestonePer: 5,
  perfect: 250,
};

/** Надбавка за траекторию: чем непривычнее тарелка, тем дороже попадание. */
export const KIND_BONUS = {
  cross: 0,     // поперёк, из боковых машинок
  outgoer: 2,   // из-за спины прямо от стрелка
  diagL: 3,     // из-за спины по диагонали влево
  diagR: 3,     // из-за спины по диагонали вправо
  teal: 3,      // «свеча»: вертикально вверх и вниз
  overhead: 4,  // сверху: летит на стрелка и над головой
  rabbit: 5,    // «заяц»: катится и подпрыгивает по земле
};
const MAX_KIND_BONUS = Math.max(...Object.values(KIND_BONUS));

/** Очки за одно попадание. p — доля пути тарелки (0…1), streak — длина серии вместе с этим попаданием. */
export function hitPoints(p, streak, kind = 'cross') {
  const dist = Math.round(Math.min(1, Math.max(0, p)) * RULES.distance);
  const base = RULES.base + dist + (KIND_BONUS[kind] ?? 0);
  const streakBonus = Math.min(RULES.streakMax, Math.max(0, streak - 1) * RULES.streakStep);
  const milestone = streak > 0 && streak % RULES.milestoneEvery === 0 ? streak * RULES.milestonePer : 0;
  return { base, streakBonus, milestone, total: base + streakBonus + milestone };
}

export const isPerfect = (hits, shots, round) => hits === round && shots === hits;

/** Наибольший возможный счёт при таком числе попаданий — для проверки на сервере. */
export function maxScore(hits, shots, round) {
  let sum = 0;
  // лучший случай: все попадания одной серией по самым дорогим тарелкам
  for (let s = 1; s <= hits; s++) sum += hitPoints(1, s).total + MAX_KIND_BONUS;
  return sum + (isPerfect(hits, shots, round) ? RULES.perfect : 0);
}
