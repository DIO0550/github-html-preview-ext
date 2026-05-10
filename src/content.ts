import { startObserving } from './content/observer';
import {
  getCachedSettings,
  loadSettings,
  subscribeSettingsChanges,
} from './content/settings';
import { handlePageUpdate } from './content/page-handler';
import { resetAllAutoUpdateCaches } from './content/auto-update-cache';

void loadSettings().then(() => {
  startObserving(() => {
    handlePageUpdate(location.pathname, getCachedSettings());
  });

  subscribeSettingsChanges((next) => {
    resetAllAutoUpdateCaches();
    handlePageUpdate(location.pathname, next);
  });
});
