/**
 *  Koa2 router with integrated RBAC
 */

// TODO:
// - implement `all` | `any` HTTP verbs

/* eslint-disable prefer-const, no-unused-expressions, no-cond-assign, no-return-assign */

'use strict'

const RBAC = require('./rbac')

// *** constants and helpers ***

// router properties
const CONFIG = Symbol('CONFIG')
const PARENT = Symbol('PARENT')
const ROUTES = Symbol('ROUTES')
// parametric branch property
const $ = Symbol('$')
// parameter name property
const $_PARAM = Symbol('$_PARAM')
// route HTTP methods property
const METHODS = Symbol('METHODS')
// route handler/s function / array
const HANDLER = Symbol('HANDLER')
// route name property
const NAME = Symbol('NAME')
// route prefix
const PREFIX = Symbol('PREFIX')

const ANY = '*'

// default config
const DEFAULTS = {
  // ctxRolesFetcher: [Async]Function,
  // prohibitHandler: [Async]Function,
  // preambleHandler: [Async]Function | Array<[Async]Function>,
  notFoundHandler: ctx => ctx.throw(404),
  noMethodHandler: ctx => DEFAULTS.notFoundHandler(ctx)
}

// error helpers
class RouterError extends Error {}
const throwError = message => { throw new RouterError(message) }

// async call helper
const asyncCall = (fn, scope, ...args) =>
  fn instanceof Function
    ? new Promise((resolve, reject) => {
      try { // prevent unhandled promise rejection
        let result = fn.apply(scope, args)
        result !== undefined && (
          Promise.resolve(result) === result
            ? result.then(resolve).catch(reject)
            : resolve(result)
        )
      } catch (err) {
        reject(err)
      }
    })
    : Promise.resolve(fn)

// set of known named routes (actions | permissions)
const actions = new Set()

// split HTTP path onto chunks and remove blanks
const splitRoutePath = (path) => path.split(Router.PATH_DELIM).filter(Boolean)

//
// *** implementation ***
//

// the very first router instance
let rootRouter = null

// router config getter
const config = router => Object.assign(
  {},
  router[PARENT] && config(router[PARENT]),
  router[CONFIG]
)

// request handler and router instance
async function router (ctx, next) {
  // - request params container
  let params = {}
  // - router (requestHandler scope)
  let router = rootRouter
  // - lookup route
  let route = router[ROUTES]
  // - handle request path
  let chunks = splitRoutePath(ctx.path)
  // break early if no route found
  chunks.every(chunk => {
    route = route[chunk.toLowerCase()] || (
      (route = route[$]) && (params[route[$_PARAM]] = chunk) && route
    )
    // handle middleware)
    if (route instanceof Function) return false
    // handle sub-router
    if (route instanceof Router) [router, route] = [route, route[ROUTES]]
    return route
  })
  // - route not found
  if (!route) return asyncCall(config(router).notFoundHandler, router, ctx)
  // - handle middleware
  if (route instanceof Function) {
    // remove prefix (see `use` routine)
    ctx.path = ctx.path.substr(route[PREFIX].length) || '/'
    return route(ctx, next)
  }
  // - lookup route methods(s)
  let method = route[METHODS] && (
    route[METHODS][ctx.method.toLowerCase()] || route[METHODS][ANY]
  )
  // - route methods not found
  if (!(method && method[HANDLER])) return asyncCall(config(router).noMethodHandler, router, ctx)
  // - effective router config
  const {
    ctxRolesFetcher,
    preambleHandler,
    prohibitHandler
  } = config(router)
  const { CTX_ACTION, CTX_PARAMS } = Router
  // - extend context
  Object.assign(ctx, {
    ...(method[NAME] && { [CTX_ACTION]: method[NAME] }),
    [CTX_PARAMS]: params
  })
  // - perform RBAC check
  if (ctxRolesFetcher && method[NAME]) {
    let roles = await asyncCall(ctxRolesFetcher, router, ctx)
    if (!RBAC.match(method[NAME], roles)) {
      return prohibitHandler ? asyncCall(prohibitHandler, router, ctx) : ctx.throw(403)
    }
  }
  // - construct call chain
  return (
    // construct handlers chain
    (preambleHandler ? [].concat(preambleHandler) : [])
      .concat(method[HANDLER])
      .reduceRight(
        (next, fn) => async () => {
          // eslint-disable-next-line
          let done = fn(ctx, /* next */ async () => (await next(), next = null))
          // await resolution of async call chain
          while (Promise.resolve(done) === done) done = await done
          // call `next` if exists (or not yet called)
          return next ? next() : Promise.resolve()
        },
        () => true
      )
  )()
}

// map(...args) parse helper
const routeSpecMap = [
  // 0: invalid invocation
  null,
  // 1: route({ ... })
  descriptor =>
    // validate descriptor
    descriptor instanceof Object
      // validate mapping
      ? descriptor.mapping
        // validate handler
        ? descriptor.handler instanceof Function || (
          Array.isArray(descriptor.handler) &&
            descriptor.handler.every(fn => fn instanceof Function))
          ? descriptor
          : throwError('route \'handler\' is mandatory and must be a function')
        : throwError('route \'mapping\' is mandatory')
      : throwError('invalid route descriptor'),
  // 2: route(mapping, handler)
  (mapping, handler) => routeSpecMap[1]({ mapping, handler }),
  // 3: route(name, mapping, handler)
  (name, mapping, handler) => routeSpecMap[1]({ name, mapping, handler })
]

/**
 * Route define routine
 */
function map (...args) {
  // router config options
  const { PARAM_MARK } = Router
  // route spec
  let spec = routeSpecMap[args.length](...args)
  // check route name (permission) uniqueness
  if (actions.has(spec.name)) throwError(`non-unique route name: '${spec.name}'`)
  // get HTTP method and path from route mapping
  let [method, path] = spec.mapping.split(/\s+/)
  path
    ? method = method.toLowerCase()
    : [method, path] = [ANY, method]
  // route params set
  let params = new Set()
  // traverce routes graph by path chunks
  let route = this[ROUTES]
  for (let chunk of splitRoutePath(path)) {
    chunk.charAt(0) === PARAM_MARK
      // - parametric branch -
      ? (chunk = chunk.slice(1)) // get param name
        ? (route = route[$] || (
          params.has(chunk) // check for same-named parameters
            ? throwError(`duplicate parameter '${chunk}' in route '${spec.mapping}'`)
            // create branch if not exists
            : route[$] = { [$_PARAM]: chunk }
        ))[$_PARAM] === chunk // check param name consistency
          // add param into list and proceed
          ? (params.add(chunk), route)
          // params collision
          : throwError(`collision of parameters '${route[$_PARAM]}' and '${chunk}' in route '${spec.mapping}'`)
        // unnamed params are not allowed
        : throwError(`unnamed parameter in route '${spec.mapping}'`)
      // - common branch -
      : (
        // get next route or create if needed
        chunk = chunk.toLowerCase(),
        route = route[chunk] || (route[chunk] = {}),
        route instanceof Function && throwError('path is used by middleware'),
        // substitute Router instance graph (see Router.use(...))
        route instanceof Router ? route[ROUTES] : route
      )
  }
  // store route attributes:
  Object.assign(route, {
    // - handler
    [METHODS]: Object.assign(route[METHODS] || {}, {
      [method]: {
        [HANDLER]: spec.handler,
        // - name (no need to create property for empty value)
        ...(spec.name && { [NAME]: spec.name })
      }
    })
  })
  // append new action (permission)
  if (route[NAME]) actions.add(route[NAME])
  // return Router instance for chaining
  return this
}
// HTTP method helpers
function method (verb, name, path, handler) {
  handler || (handler = path, path = name, name = undefined)
  let args = (name ? [name] : []).concat(`${verb} ${path}`, handler)
  map.apply(this, args)
  // return Router instance for chaining
  return this
}

/**
 * Use other middleware on specified prefix
*/
function use (prefix, target) {
  // assert params
  if (!prefix || prefix.constructor !== String) throwError('expected prefix string')
  if (typeof target != 'function') throwError('expected middleware function or Router instance') // eslint-disable-line
  // find mount point
  const { PARAM_MARK } = Router
  let router = this
  let chunks = splitRoutePath(prefix)
  let point = chunks.pop() || throwError(`invalid prefix: ${prefix}`)
  point.charAt(0) === PARAM_MARK && throwError(`parametrized prefix: ${prefix}`)
  let mount = chunks.reduce(
    (route, chunk) => {
      // assert prefix chunk
      chunk.charAt(0) === PARAM_MARK && throwError(`parametrized prefix: ${prefix}`)
      // get next route or create if needed
      chunk = chunk.toLowerCase()
      route = route[chunk] || (route[chunk] = {})
      if (route instanceof Function) throwError('prefix path is used by middleware')
      return route instanceof Router
        ? (router = route, route[ROUTES])
        : route
    },
    this[ROUTES]
  )
  // set Router parent
  target instanceof Router && (target[PARENT] = router)
  target[PREFIX] = prefix
  // 'mount' target
  mount[point] = target
  // return Router instance for chaining
  return this
}

/**
 * Router class
 */
function Router (opts) {
  // validate opts
  if (opts) {
    opts.ctxRolesFetcher && (
      opts.ctxRolesFetcher instanceof Function ||
        throwError('`ctxRolesFetcher` must be a function')
    )
    opts.prohibitHandler && (
      opts.prohibitHandler instanceof Function ||
        throwError('`prohibitHandler` must be a function')
    )
  }
  // create router instance
  const instance = router.bind(this)
  rootRouter || (rootRouter = instance)
  // make instanceof operator working
  Object.setPrototypeOf(instance, Router.prototype)
  // instance config
  instance[CONFIG] = opts
  // instance routes
  instance[ROUTES] = {}
  // setup router instance
  // define config getter
  Object.defineProperty(instance, 'config', {
    get: () => config(instance)
  })
  Object.assign(instance, {
    [CONFIG]: Object.isFrozen(DEFAULTS)
      ? opts
      : Object.freeze(Object.assign(DEFAULTS, opts)),
    [ROUTES]: this,
    map: map.bind(instance),
    use: use.bind(instance)
  })
  // expose HTTP verbs
  for (let verb of Router.HTTP_VERBS) instance[verb] = method.bind(instance, verb)
  instance['any'] = instance['all'] = method.bind(instance, ANY)
  //
  return instance
}

// export Router API and defaults
Object.assign(Router, {
  // router error class
  Error: RouterError,
  // request context properties
  CTX_ACTION: 'action',
  CTX_PARAMS: 'params',
  // list of HTTP methods to expose on router instance
  HTTP_VERBS: ['get', 'post', 'put', 'delete'],
  // route path parameter mark
  PARAM_MARK: ':',
  // route path delimiter
  PATH_DELIM: /\/+/
})

module.exports = exports = Router
