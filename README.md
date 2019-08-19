# koa2-rbac-router

> Koa2 router middleware with integrated role-based access control.

- Classic routes definition using `router.get`, `router.post`, `router.put`, `router.delete`, etc.
- Named URL parameters (with configurable marker).
- Named routes (actions).
- Multiple routers.
- Nestable routers / middlewares.
- ES7 async request handlers.
- Out-of-box simple but yet flexible role-based access control (RBAC).
- MIT License.

## Intro

Main goal of this lib is to provide flexible Koa2 router with integrated role-based access
control (RBAC). Basic idea is simple: to perform access control route should be defined with name
(named routes are called 'actions'). Router automatically matches access to the route with RBAC
definitions using route name as RBAC permission (ability) identifier. RBAC role, in general, is a
simple list of accepted actions (route names). When request arrives router fetches context role(s)
(through special callback function `ctxRolesFetcher`) and resolves them into list of allowed
actions (route names), then verifies if current route name exists in resolved actions list. If
action is allowed router passes request to downstream handlers or returns `403 Forbidden` HTTP
error otherwise. Additionally, RBAC supports roles inheritance and actions/roles exclusion.

For example:
```javascript
RBAC.setup({
  // define `guest` role
  guest: 'index, signup, signin',
  // define common `user` role
  user: '@guest, ownAction, !signup, !signin'
});
```

Example above defines:
- `guest` role with allowed actions: `index`, `signup` and `signin`;
- `user` role which 'inherits' role `guest` (with `@guest` construct), defines own permission:
`ownAction` and excludes permissions `signup` and `signin` inherited from `guest` role. Resulting
`user` role permissions are: `index` and `ownAction`.

> Roles might be excluded as well with construction `!@<role>`, what means exclusion of all `<role>`
  permissions _requrcively_: permissions inherited by `<role>` get excluded as well.

Futhermore, any dependend role will be automatically adjusted if inherited role gets updated,
for example above:
```javascript
RBAC.apply('guest', 'index, signup, signin, welcome');
```
adjusts `user` role as well, and its resulting permissions set becomes: `index`, `welcome`, and
`ownAction`.

Sinces roles definitions are simple strings (or arrays) it's easy to store them in files, DBs or
any other storages: it's up to a programmer how to handle this. Same is about storing request
context roles which are expected to be strings of space and/or comma separated list of role names
(or array of role names). Obvious solution here is to use a session storage.


## Installation

- **npm:**
```bash
npm install koa2-rbac-router
```

- **yarn:**
```bash
yarn add koa2-rbac-router
```

## API Reference

- Router
  - `new Router ([opts])`
  - _Instance members_
      - `map(descriptor | [name], mapping, handler) => Router`
      - `get|post|put|delete|...|all([name], path, handler) => Router`
      - `use(prefix, mw) => Router|Function`
  - _Static members_
      - `Error`
      - `CTX_ACTION`
      - `CTX_PARAMS`
      - `HTTP_VERBS`
      - `PARAM_MARK`
      - `PATH_DELIM`
- Role-based access control (RBAC)
  - `build([force=false]) => RBAC`
  - `imply(name, spec) => RBAC`
  - `match(perm, roles) => Boolean`
  - `resolve(name) => Set<String>`
  - `setup(specs, [prebuild=true]) => RBAC`
  - `unset(name) => RBAC`
  - `Error`
  - `EXCLUDE_MARK`
  - `ROLE_REF_MARK`
  - `RX_DELIMITER`
- Example

---

### Router

Exported class.


#### `new Router([opts])`

Create a new router instance.

- `opts` `Object` _optional_

  Router instance configuration properties:

  * `ctxRolesFetcher` `[Async]Function` _optional_

      Context roles fetcher. Automatic RBAC checks are disabled if this routine not set.

      Call signature:
      ```javascript
        [async] function (ctx) {
            // example:
            return ctx.session.roles;
        }
      ```

  * `prohibitHandler` `[Async]Function` _optional_

      Request prohibit handler (see RBAC). By default (when this option is omitted) `ctx.throw(403)` is used.

      Call signature:
      ```javascript
        [async] function (ctx) {
            // example:
            ctx.body = 'Access denied';
            ctx.throw(403);
        }
      ```

  * `preambleHandler` `[Async]Function | Array<[Async]Function>` _optional_

      Function (or array of functions) to be invoked before any request handlers in call chain.

      Call signature:
      ```javascript
      [async] function (ctx, next) { ... }
      ```

      `next` is _asynchronous_ downstream invokation routine:
      ```javascript
      async function (ctx, next) {
          // preprocess request
          ...
          // await for downstream handlers
          await next();
          // postprocess request
          ...
      }
      ```

  * `notFoundHandler` `[Async]Function` _optional_

      Request route not found handler.

      Call signature:
      ```javascript
      [async] function (ctx) {
          // default behaviour:
          ctx.throw(404);
      }
      ```

  * `noMethodHandler` `[Async]Function` _optional_

      Request method not found handler. By default `opts.notFoundHandler` routine is used (see above).

      Call signature:
      ```javascript
      [async] function (ctx) {
          // example:
          ctx.throw(501); // return `Not Implemented` HTTP error
      }
      ```

> NOTE: `[async]` notation means _optionally asynchronous_.

#### _Instance members_

#### `router.map(descriptor | [name], mapping, handler) => Router`

Define new route.

- `descriptor` `Object`

    Route descriptor object of following options:

- `name` `String` _optional_

    Unique (in scope of _all_ `Router` instances) route name, which is used for matching access
    permissions (see RBAC below). Unnamed routes are handled unrestricted (with no RBAC checks).

- `mapping` `String` _required_

    Route mapping of form: `'[<METHOD>] <PATH>'`, where:

    * `<METHOD>` is HTTP method name: `GET`, `POST`, `PUT`, `DELETE`, etc; omitted or specified as
      `'*'` value means wildcard or default (fallback) HTTP method handler.
    * `<PATH>` is route path of form `{ /<chunk>|:<param> }`, where: `<chunk>` is path chunk and
      `:<param>` is path named parameter (additionally, see `PARAM_MARK`).

      __Important:__ route params MUST be same-named in same route paths. For example, following
      mappings cause parameters collision error, due to attempt of use different names for same parameter:

      `'GET /items/:serNum'`

      `'PUT /items/:serNum'`

      `'DELETE /items/:itemId'` - ERROR: parameter should be `:serNum` as in other routes of path `/items`.

- `handler` `[Async]Function | Array<[Aync]Function>` _required_

    Asynchronous (optionally) request handling routine (or array of routines).

    Call signature:
    ```javascript
    [async] function (ctx, next) { ... }
    ```

    `next` is _asynchronous_ downstream invocation routine:
    ```javascript
    async function (ctx, next) {
        // preprocess request
        ...
        // await for downstream handlers
        await next();
        // postprocess request
        ...
    }
    ```

    __Important:__ Before calling request specific handler(s) router invokes its
    `opts.preambleHandler` if it was configured (see `new Router([opts])`).


#### `router.get|post|put|delete|...|all([name], path, handler) => Router`

Route classic definition helpers. Functions determine corresponding route HTTP methods. The list of
exposed functions is specified by `Router.HTTP_VERBS` parameter.

- `name` - see `map(...)` `name`

- `path` - see `map(...)` `mapping <PATH>`

- `handler` - see `map(...)` `handler`


#### `router.use(prefix, target) => Router | Function`

Mount sub-router or middleware function on specified prefix.

- `prefix` `String` _required_

    Target mount point. This `prefix` will be cut off from `ctx.path` before passing control to
    downstream handlers.

    > NOTE: at the moment parametrized prefixes are not supported.

- `target` `Router | [Async]Function` _required_

    Target `Router` instance or Koa2 common middleware function to be used on specified prefix.

__Important:__ Sub-routers are not enforced to define own config options with `new Router([opts])`.
Each subrouter recursively 'inherits' unspecified config options from its parent router(s).


#### _Static members_


#### `Router.Error` `class`

Router-specific error class.


#### `Router.CTX_ACTION` `String`

Koa context property containing request action (route name). Default: `'action'`.


#### `Router.CTX_PARAMS` `String`

Koa context property containing request path parameters. Default: `'params'`.


#### `Router.HTTP_VERBS` `Array<String>`

List of HTTP verbs to expose as `Router` instance methods. Default: `['get', 'post', 'put', 'delete']`.


#### `Router.PARAM_MARK` `String`

Route parameter marker char. Default: `':'`.


#### `Router.PATH_DELIM` `String|RegExp`

Delimiter used for splitting route path into chunks. Default: `/\/+/`.

---

### Role-based access control (RBAC)

Following methods, classes and options are members of `RBAC` namespace.


#### `RBAC.build([force=false]) => RBAC`

Preprocess and compile roles (see `setup(...)`).

- `force` `Boolean` _optional_

  All roles re-compilation forcing flag.


#### `RBAC.apply(name, spec) => RBAC`

Apply role (new) spec, initiate dependent roles recompilation.

- `name` `String` _required_

  Role name.

- `spec` `String|Array<String>` _required_

  Role spec in one of following formats:
  * `String`: space and/or comma separated list of spec tokens;
  * `Array<String>`: array of spec tokens.

  Spec tokens could be:
  * route action (named route) inclusion, meaning that specified action is permitted by the role;
  * another role inclusion, marked by role reference mark (see `ROLE_REF_MARK`, default: `@`),
    meaning recursive inclusion of all actions from specified role;
  * exclusion of action or role, marked by exclude mark (see `EXCLUDE_MARK`, default: `!`),
  meaning removal of an action or recursive removal of all actions from specified role (marked as:
  `!@excludedRoleName`).

  __Important__: appearance order of tokens in role spec _DOES_ matter: precedence grows from left
  to right, what means, for example, inclusion of role that permits (contains) action `someAction`
  _after_ exclusion of this action (`!someAction`) leads to presense of `someAction` in subject role.


#### `RBAC.match(action, roles) => Boolean`

Check if action is permitted by specified role(s).

- `action` `String` _required_

  Action name to match.

- `roles` `String|Array<String>` _required_

  Single role name or space and/or comma separated list or array of roles to match.

This method is used internally by `Router` to match access permissions (see `ctxRolesFetcher`).


#### `RBAC.resolve(name) => Set<String>`

Resolve role to a set of permitted actions.

- `name` `String` _required_

  Name of role to resolve.


#### `RBAC.setup(specs, [prebuild=true]) => RBAC`

Reset RBAC controller with provided roles specs batch.

- `specs` `Object` _required_

  Role spec object, where property name is treated as role name and value as role spec (see `RBAC.apply`).

- `prebuild` `Boolean` _optional_

  Roles prebuild flag (default: `true`). If set to `false` none role spec is preprocessed until
  `RBAC.resolve(...)` or `RBAC.build()`.


#### `RBAC.unset(name) => RBAC`

Undefine role, initiate dependent roles recompilation.


#### `RBAC.Error`

RBAC-specifix error class.


#### `RBAC.EXCLUDE_MARK`

Action/role exclude mark. Default: `!`.


#### `RBAC.ROLE_REF_MARK`

Role reference mark. Default: `@`.


#### `RBAC.RX_DELIMITER`

Spec delimiter regexp. Default: `/[,\s]+/`.


### Example
```javascript

const { Router, RBAC } = require('koa2-rbac-router');

const rootRouter = new Router({
  /* this function might be async */
  ctxRolesFetcher: ctx => ctx.session.roles // just an example
});

rootRouter
  /* simple mapping */
  .map('GET /', ctx => { ctx.body = 'Welcome!' })
  /* classic named route definition */
  .get('test', '/test', ctx => { ctx.body = 'test' })
  .map('verify', '/verify', ctx => { ctx.body = { error: false, verified: true } });

/* authentication check */
async function authCheck (ctx, next) {
  // auth check code
  if (ctx.username !== 'valid_username') ctx.throw(401);
  // await downstream request handlers
  await next();
  // postprocess request response
  ctx.body.done = true;
};

// define subrouter with actions (named routes)
const someRouter = new Router({
  preambleHandler: authCheck // will be invoked before any route handlers of someRouter
});
someRouter
  .map('readSomeList', 'GET /', ctx => { /* ... */ })
  .get('readSomeItem', '/:itemId', async ctx => { /* ... */ })
  .put('editSomeItem', '/:itemId', async ctx => { /* ... */ });
// 'mount' someRouter
rootRouter.use('/some', someRouter);

// define RBAC
RBAC.setup({
  // 'tester' role permits:
  //    - 'test' action: GET /test
  //    - 'verify' action: * /verify
  tester: 'test, verify',
  // 'reader' role permits actions:
  //    - whatever 'tester' role permits;
  //    - 'readSomeList': GET /some/:itemId
  reader: '@tester, readSomeItem', // -> test, verify, readSomeItem
  // 'writer' role permits:
  //    - whatever 'reader' role does;
  //    - except 'test' action;
  //    - 'editSomeItem' action: PUT /some/:itemId
  writer: ['@reader', '!test', 'editSomeItem'] // -> verify, readSomeItem, editSomeItem
});
// adjust 'reader' role
RBAC.apply('reader', '@tester readSomeList readSomeItem');

// 'writer' role should be recompiled
console.log(RBAC.resolve('writer'));
// expected: Set { verify, readSomeList, readSomeItem, editSomeItem }

// adjust 'writer' role again (note '!@test' instead of '!test')
RBAC.apply('writer', '@reader !@tester editSomeItem');
// `writer` role must be recompiled
console.log(RBAC.resolve('writer'));
// expected: Set { readSomeList, readSomeItem, editSomeItem }

// match permissions
console.log(RBAC.match('editSomeItem', 'reader, writer')); // true
console.log(RBAC.match('verify', 'tester')); // true
console.log(RBAC.match('verify', 'writer')); // false

```

## License and Copyright

This software is a subject of MIT License:

Copyright 2019 Igor V. Dyukov

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
