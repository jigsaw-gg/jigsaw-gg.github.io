import type { Messages } from './types.ts'

function ruPieces(count: number): string {
  const n = Math.abs(count)
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'деталь'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'детали'
  return 'деталей'
}

export const ru: Messages = {
  nav: {
    primary: 'Основная',
    newPuzzle: 'Новый пазл',
    network: 'Состояние сети',
    about: 'О сайте',
    menu: 'Меню',
    close: 'Закрыть',
  },
  fullscreen: {
    enter: 'На весь экран',
    exit: 'Выйти из полноэкранного режима',
    embeddedSafari:
      'Откройте эту страницу в отдельном браузере Safari, чтобы включить полноэкранный режим',
  },
  language: {
    button: 'Язык',
    title: 'Язык',
    close: 'Закрыть',
  },
  theme: {
    group: 'Цветовая тема',
    system: 'Система',
    light: 'Светлая',
    dark: 'Тёмная',
  },
  connection: {
    starting: 'Запуск',
    connecting: 'Подключение',
    connected: 'Подключено',
    disconnected: 'Отключено',
    unavailable: 'Недоступно',
    pill: (label) => `Apinator ${label}`,
  },
  network: {
    title: 'Состояние сети',
    lede: 'Соединение с Apinator в этом браузере: кластер, канал, подписка и недавние сообщения.',
    cluster: 'Кластер',
    channel: 'Канал',
    event: 'Событие',
    subscription: 'Подписка',
    socket: 'Сокет',
    appKey: 'Ключ приложения',
    failed: 'Ошибка',
    subscribed: 'Подписано',
    subscribing: 'Подписка…',
    waiting: 'Ожидание соединения',
    mock: 'Локальная заглушка',
    notConfigured: 'Не задан',
    recent: 'Недавние сообщения my-event',
    empty: 'Сообщений пока нет.',
  },
  about: {
    title: 'О сайте',
    lede: 'Временная страница. Сайт будет на jigsaw-gg.github.io. В шапке переключается системная, светлая и тёмная тема, а на странице состояния сети показана связь с Apinator.',
    version: 'Версия',
    commitShow: 'Показать коммит',
    commitHide: 'Скрыть коммит',
    telegramDebug: 'Telegram Mini App',
    telegramUrlParams: 'Параметры запуска из URL Telegram',
    telegramUrlParamsEmpty: 'Нет параметров tgWebApp* в URL или хранилище SDK.',
  },
  puzzles: {
    title: 'Новый пазл',
    lede: 'Выберите изображение и число деталей. Выберите имя, которое увидят другие игроки. Зерно задаётся здесь. «Начать» открывает закрытую сессию и ссылку-приглашение.',
    imageUrl: 'URL изображения',
    imagePreview: 'Предпросмотр изображения пазла',
    gallery: 'Выбрать из галереи',
    galleryImage: (index) => `Изображение галереи ${index}`,
    pieces: 'Детали',
    imageSize: 'Размер изображения',
    unavailable: 'Недоступно',
    loading: 'Загрузка…',
    arrangement: 'Раскладка',
    pieceCount: (count) => `${count} ${ruPieces(count)}`,
    seed: 'Зерно',
    start: 'Начать',
    imageError: 'Не удалось загрузить это изображение.',
  },
  player: {
    name: 'Ваше имя',
    hint: 'Это имя увидят другие игроки сессии. Оно сохраняется в этом браузере и подставится в следующий раз.',
    you: 'вы',
    host: 'ведущий',
    fallback: 'Игрок',
  },
  play: {
    unknownTitle: 'Неизвестная сессия',
    unknownLede: 'Эта ссылка-приглашение не ведёт к сессии пазла.',
    joinTitle: 'Присоединиться к пазлу',
    joinLede:
      'Выберите имя, которое увидят другие игроки, прежде чем войти в эту сессию.',
    join: 'Войти',
    sessionTitle: 'Сессия пазла',
    sourcePeer:
      'Настройки пришли от подключённого игрока и сохранены в этом браузере.',
    sourceLocal:
      'Настройки сохранены в этом браузере. Подключённые игроки могут их запросить.',
    sourceWaiting:
      'Ожидание подключённого игрока, у которого уже есть эта сессия.',
    players: 'Игроки',
    persistence:
      'Положения деталей сохраняются в этом браузере. Закрытие вкладки или потеря связи не сбрасывает пазл. Ведущий разрешает спор, когда двое игроков одновременно подтверждают одну деталь. Более новый ход заменяет более старый.',
    waitingOthers: 'Ожидание других игроков.',
    invite: 'Ссылка-приглашение',
    inviteTelegram: 'Приглашение Telegram Mini App',
    copied: 'Скопировано',
    copyInvite: 'Копировать приглашение',
    copyInviteTelegram: 'Копировать приглашение Telegram',
    play: 'Играть',
    channel: 'Канал',
    channelStatus: 'Состояние канала',
    joined: 'Подключено',
    failed: 'Ошибка',
    joining: 'Подключение…',
    image: 'Изображение',
    pieces: 'Детали',
    seed: 'Зерно',
    asking:
      'Запрос у подключённых игроков изображения, размера, числа деталей и зерна.',
    playArea: 'Игровое поле',
    imageError: 'Не удалось загрузить изображение пазла.',
    back: 'Назад',
    piece: (row, col) => `Деталь ${row}-${col}`,
    pointer: (name) => `Указатель игрока ${name}`,
    handoverRight: 'Деталь переходит к правому большому пальцу',
    handoverLeft: 'Деталь переходит к левому большому пальцу',
    gamepad: 'Геймпад подключён',
    win: 'Победа!',
    gamepadHelpCue: 'Справка',
    gamepadHelpTitle: 'Геймпад',
    gamepadHelpClose: 'Закрыть справку',
    gamepadHelp: {
      leftStick: 'Двигать указатель или выбранную деталь',
      rightStick: 'Панорамировать стол или смотреть, держа деталь',
      l1: 'Взять подсвеченную деталь или положить её',
      r1: 'Удерживать для половинной скорости стиков',
      l2: 'Приблизить',
      r2: 'Отдалить',
      dpad: 'Перевести подсветку на соседнюю деталь',
      triangle: 'Показать или скрыть эту справку',
      cross: 'Подтвердить выбранный пункт меню',
    },
  },
  errors: {
    appKeyMissing: 'Ключ приложения не задан.',
    connection: 'Ошибка соединения',
    channelJoin: 'Не удалось подключиться к закрытому каналу.',
  },
}
