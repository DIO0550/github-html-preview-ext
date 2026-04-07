import { startObserving } from './content/observer';
import { loadSettings } from './content/settings';
import { handlePageUpdate } from './content/page-handler';

loadSettings().then((settings) => {
  startObserving(() => {
    handlePageUpdate(location.pathname, settings);
  });
});
