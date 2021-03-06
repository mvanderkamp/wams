/*
 * Test suite for src/server.js
 *
 * Author: Michael van der Kamp
 * Date: July/August 2018
 */

'use strict';

const Api = require('server.js');
const Application = require('server/Application.js');
const Router = require('server/Router.js');

test('Expected values were correctly exported', () => {
  expect(Api).toBeInstanceOf(Object);
  expect(Api.Application.prototype).toBe(Application.prototype);
  expect(Api.Router).toBeInstanceOf(Function);
});


