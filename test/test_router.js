/**
 * lib/router.js tests
*/

/* eslint-disable prefer-const */

'use strict'

const test = require('ava')

const RBAC = require('../lib/rbac')

RBAC.apply('routerTestRole', ['acceptedAction'])

// testing subject
const Router = require('../lib/router')

// update config
Router.CTX_ACTION = 'routeName'
Router.CTX_PARAMS = 'args'
Router.PARAM_MARK = '$'

// fake Koa2 request context mock
const newCtx = spec => {
  const [method, path] = spec.split(' ')
  return {
    body: {},
    method,
    path,
    throw: (msg) => {
      throw Error(msg)
    }
  }
}

// helper
const handler = async ctx => { ctx.body = { done: true } }

const router = new Router({
  preambleHandler: [
    async ctx => (ctx.preamble1 = true),
    async ctx => {
      ctx.preamble2 = true
    }
  ],
  ctxRolesFetcher: async ctx => 'routerTestRole',
  customOption: 'some value'
})

router
  .map('/', handler)
  .get('/test', handler)
  .get('/test/$id', handler)
  .post('/test', handler)
  .put('/test/$id', handler)
  .delete('/test/$id', handler)
  .map('GET /multiple', [
    async ctx => { ctx.body.done1 = true },
    async ctx => { ctx.body.done2 = true }
  ])
  .map('GET /multiple2', [
    async (ctx, next) => { await next(); ctx.body += 'done1' },
    async ctx => { ctx.body = 'done2 ' }
  ])
  .get('acceptedAction', '/acceptedAction', handler)
  .get('forbiddenAction', '/forbiddenAction', handler)

const subRouter = new Router()
subRouter.get('/', handler)
router.use('/sub', subRouter)

// router.map('named', )

test('Router: config', async assert => {
  assert.plan(4)
  assert.true(router.config.notFoundHandler instanceof Function)
  assert.true(router.config.noMethodHandler instanceof Function)
  assert.true(router.config.ctxRolesFetcher instanceof Function)
  assert.is(router.config.customOption, 'some value')
})

test('Router: preamble handler', async assert => {
  let ctx = newCtx('GET /')
  await router(ctx)
  assert.true(ctx.preamble1 && ctx.preamble2)
})

test('Router: route handling', async assert => {
  assert.plan(3)
  let ctx
  ctx = newCtx('GET /')
  await router(ctx)
  assert.true(ctx.body.done)
  ctx = newCtx('GET /test')
  await router(ctx)
  assert.true(ctx.body.done)
  ctx = newCtx('POST /test')
  await router(ctx)
  assert.true(ctx.body.done)
})

test('Router: parametrized route handling', async assert => {
  assert.plan(6)
  let ctx
  ctx = newCtx('GET /test/1234567890')
  await router(ctx)
  assert.true(ctx.body.done)
  assert.is(ctx[Router.CTX_PARAMS].id, '1234567890')
  ctx = newCtx('PUT /test/1234567890')
  await router(ctx)
  assert.true(ctx.body.done)
  assert.is(ctx[Router.CTX_PARAMS].id, '1234567890')
  ctx = newCtx('DELETE /test/1234567890')
  await router(ctx)
  assert.true(ctx.body.done)
  assert.is(ctx[Router.CTX_PARAMS].id, '1234567890')
})

test('Router: multiple route handlers', async assert => {
  let ctx = newCtx('GET /multiple')
  await router(ctx)
  assert.true(ctx.body.done1 && ctx.body.done2)
})

test('Router: multiple route handlers (await next())', async assert => {
  let ctx = newCtx('GET /multiple2')
  await router(ctx)
  assert.is(ctx.body, 'done2 done1')
})

test('Router: `use` middleware', async assert => {
  router.use('/test/sub/mw', handler)
  let ctx = newCtx('GET /test/sub/mw/sub-path')
  await router(ctx)
  assert.true(ctx.body.done)
  assert.is(ctx.path, '/sub-path')
})

test('Router: `use` sub-router', async assert => {
  const testRouter = new Router()
  testRouter.get('/', handler)
  router.use('/test/sub/test', testRouter)
  let ctx = newCtx('GET /test/sub/test')
  await router(ctx)
  assert.true(ctx.body.done)
})

test('Router: unknown route', async assert => {
  let ctx = newCtx('GET /unknown')
  try {
    await router(ctx)
  } catch (e) {
    assert.is(e.message, '404')
  }
})

test('Router: unknown method', async assert => {
  let ctx = newCtx('PATCH /test')
  try {
    await router(ctx)
  } catch (e) {
    assert.is(e.message, '404')
  }
})

test('Router: named route (action)', async assert => {
  let ctx = newCtx('GET /acceptedAction')
  await router(ctx)
  assert.is(ctx[Router.CTX_ACTION], 'acceptedAction')
})

test('Router: RBAC accepted action', async assert => {
  let ctx = newCtx('GET /acceptedAction')
  await router(ctx)
  assert.true(ctx.body.done)
})

test('Router: RBAC forbidden action', async assert => {
  let ctx = newCtx('GET /forbiddenAction')
  try {
    await router(ctx)
  } catch (e) {
    assert.is(e.message, '403')
  }
})

test('Router: error: `ctxRolesFetcher` must be a function', async assert => {
  assert.throws(
    () => new Router({ ctxRolesFetcher: 'not a function' }),
    '`ctxRolesFetcher` must be a function'
  )
})

test('Router: error: `prohibitHandler` must be a function', async assert => {
  assert.throws(
    () => new Router({ prohibitHandler: 'not a function' }),
    '`prohibitHandler` must be a function'
  )
})

test('Router: error: invalid route descriptor', async assert => {
  assert.throws(() => router.map(true), 'invalid route descriptor')
})

test('Router: error: route \'mapping\' is mandatory', async assert => {
  assert.plan(2)
  assert.throws(() => router.map(null, handler), 'route \'mapping\' is mandatory')
  assert.throws(() => router.map('invalid', null, handler), 'route \'mapping\' is mandatory')
})

test('Router: error: route \'handler\' is mandatory', async assert => {
  assert.plan(2)
  assert.throws(() => router.map('GET /invalid', true), 'route \'handler\' is mandatory and must be a function')
  assert.throws(() => router.map('invalid', 'GET /invalid', true), 'route \'handler\' is mandatory and must be a function')
})

test('Router: error: duplicate parameter', async assert => {
  try {
    router.map('GET /test/$id/item/$id', handler)
  } catch (e) {
    assert.is(e.message, 'duplicate parameter \'id\' in route \'GET /test/$id/item/$id\'')
  }
})

test('Router: error: parameters collision', async assert => {
  try {
    router.map('GET /test/$testId', handler)
  } catch (e) {
    assert.is(e.message, 'collision of parameters \'id\' and \'testId\' in route \'GET /test/$testId\'')
  }
})

test('Router: error: invalid prefix', async assert => {
  assert.plan(2)
  const testRouter = new Router()
  try {
    router.use('', testRouter)
  } catch (e) {
    assert.is(e.message, 'expected prefix string')
  }
  try {
    router.use('/', testRouter)
  } catch (e) {
    assert.is(e.message, 'invalid prefix: /')
  }
})

test('Router: error: parametrized prefix', async assert => {
  const testRouter = new Router()
  try {
    router.use('/test/$id', testRouter)
  } catch (e) {
    assert.is(e.message, 'parametrized prefix: /test/$id')
  }
})
