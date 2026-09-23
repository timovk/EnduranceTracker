/**
 * The application's version.
 *
 * Read from package.json at build time, so there is exactly one place a
 * release number is written. The desktop shell reads the same file through
 * `app.getVersion()`, which is what keeps the title bar, the sidebar, the
 * update log and the installer's file name from ever disagreeing.
 */

import manifest from '../../package.json';

export const APP_VERSION: string = manifest.version;
