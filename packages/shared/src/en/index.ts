import { registerEnglish } from '../i18n';
import { enCommon } from './common';
import { enServer } from './server';
import { enDiscord } from './discord';
import { enWeb } from './web';
import { enModules } from './modules';
import { enMore } from './more';
import { enBadges } from './badges';
import { enSession } from './session';
import { enSchedule } from './schedule';
import { enAccounts } from './accounts';

registerEnglish({ ...enCommon, ...enServer, ...enDiscord, ...enWeb, ...enModules, ...enMore, ...enBadges, ...enSession, ...enSchedule, ...enAccounts });
