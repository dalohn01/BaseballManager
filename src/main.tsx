import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/barlow-condensed/800-italic.css';
import './ui/styles.css';
import { GameController } from './application/controller';
import { systemClock } from './platform/clock';
import { IndexedDbSaveRepository } from './platform/indexedDbRepository';
import { App } from './ui/App';
import { ControllerContext } from './ui/hooks';

const controller = new GameController(new IndexedDbSaveRepository(), systemClock, 'baseball-manager');
void controller.init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ControllerContext.Provider value={controller}>
      <App />
    </ControllerContext.Provider>
  </StrictMode>,
);
