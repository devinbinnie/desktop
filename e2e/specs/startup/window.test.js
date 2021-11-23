// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

'use strict';

const fs = require('fs');

const env = require('../../modules/environment');

describe('window', function desc() {
    this.timeout(30000);

    beforeEach(async () => {
        env.createTestUserDataDir();
        env.cleanTestConfig();
    });

    afterEach(async () => {
        if (this.app) {
            try {
                await this.app.close();
            // eslint-disable-next-line no-empty
            } catch (err) {}
        }
    });

    it.skip('MM-T4403_1 should restore window bounds', async () => {
        // TODO: Still fails in CircleCI
        // bounds seems to be incorrectly calculated in some environments
        // - Windows 10: OK
        // - CircleCI: NG
        const expectedBounds = {x: 100, y: 200, width: 800, height: 400};
        fs.writeFileSync(env.boundsInfoPath, JSON.stringify(expectedBounds));
        this.app = await env.getApp();
        const mainWindow = await this.app.firstWindow();
        const browserWindow = await this.app.browserWindow(mainWindow);
        const bounds = await browserWindow.evaluate((window) => window.getContentBounds());
        bounds.should.deep.equal(expectedBounds);
        await this.app.close();
    });

    it('MM-T4403_2 should NOT restore window bounds if x is located on outside of viewarea', async () => {
        // bounds seems to be incorrectly calculated in some environments (e.g. CircleCI)
        // - Windows 10: OK
        // - CircleCI: NG
        fs.writeFileSync(env.boundsInfoPath, JSON.stringify({x: -100000, y: 200, width: 800, height: 400}));
        this.app = await env.getApp();
        const mainWindow = await this.app.firstWindow();
        const browserWindow = await this.app.browserWindow(mainWindow);
        const bounds = await browserWindow.evaluate((window) => window.getContentBounds());
        bounds.x.should.satisfy((x) => (x > -100000));
        await this.app.close();
    });

    it('MM-T4403_3 should NOT restore window bounds if y is located on outside of viewarea', async () => {
        // bounds seems to be incorrectly calculated in some environments (e.g. CircleCI)
        // - Windows 10: OK
        // - CircleCI: NG
        fs.writeFileSync(env.boundsInfoPath, JSON.stringify({x: 100, y: 200000, width: 800, height: 400}));
        this.app = await env.getApp();
        const mainWindow = await this.app.firstWindow();
        const browserWindow = await this.app.browserWindow(mainWindow);
        const bounds = await browserWindow.evaluate((window) => window.getContentBounds());
        bounds.y.should.satisfy((y) => (y < 200000));
        await this.app.close();
    });
});
