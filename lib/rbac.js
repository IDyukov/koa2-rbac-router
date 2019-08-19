/**
 *  Role-Based Access Control
*/

// TODO:
//  - circular role referrences detection

/* eslint-disable prefer-const */

'use strict'

// debug flag
const debug = process.env.NODE_ENV === 'development'

// *** constants and helpers ***

// property to store original role spec
const SPEC = Symbol('SPEC')

// error helpers
class RBACError extends Error {}
const throwError = msg => { throw new RBACError(msg) }
const throwCompileError = (name, descr) => throwError(`could not compile role '${name}': ${descr}`)

// defined roles map
const rbac = new Map()
// role referers map
const refs = new Map()

// helper
const nullRole = Object.defineProperty(new Set(), SPEC, { value: SPEC, enumerable: debug })

// role/permission spec normalizer
const normSpec = spec =>
  spec.constructor == Array // eslint-disable-line eqeqeq
    ? spec
    : spec.constructor == String // eslint-disable-line eqeqeq
      ? spec.trim().split(RBAC.RX_DELIMITER)
      : throwError(`invalid specification: ${spec}`)

//
// *** implementation ***
//

// role `compiler`
const compile = (name, spec) => {
  let role = rbac.get(name)
  spec = spec !== undefined
    ? normSpec(spec)
    : (role && role[SPEC]) || throwCompileError(name, 'no specification')
  // new role descriptor
  role = Object.defineProperty(new Set(), SPEC, { value: spec, enumerable: debug })
  // traverse spec (if defined)
  for (let token of spec) {
    switch (token.charAt(0)) {
      // exclude
      case RBAC.EXCLUDE_MARK:
        if (token.charAt(1) === RBAC.ROLE_REF_MARK) {
          // exclude role
          token = token.substr(2) ||
            throwCompileError(name, 'invalid exclude role reference')
          for (let perm of resolve(/* role */ token)) role.delete(perm)
          // set reference on this role
          refs.set(token, (refs.get(token) || new Set()).add(name))
        } else {
          // exclude single permission
          role.delete(/* perm */
            token.substr(1) ||
              throwCompileError(name, 'invalid exclude specification')
          )
        }
        break
      // include role
      case RBAC.ROLE_REF_MARK:
        token = token.substr(1) ||
          throwCompileError(name, 'invalid role reference')
        for (let perm of resolve(/* role */ token)) role.add(perm)
        // set reference on this role
        refs.set(token, (refs.get(token) || new Set()).add(name))
        break
      // include permission
      default:
        role.add(/* perm */ token)
    }
  }
  rbac.set(name, role)
  // recompile dependent roles
  let deps = refs.get(name)
  if (deps) for (let role of deps) compile(role)
  //
  return role
}

/**
 * Compile all defined roles
 */
const build = (force = false) => {
  for (let [name, role] of rbac.entries()) (!role[SPEC] || force) && compile(name, role)
  return RBAC
}

/**
 *  Adjust existing or create new role
 */
const apply = (name, spec) => {
  rbac.has(name) && rbac.get(name).clear()
  compile(name, spec)
  // allow chaining
  return RBAC
}

/**
 * Match permission with roles
 */
const match = (perm, roles) => {
  for (let name of normSpec(roles)) {
    let role = resolve(name)
    if (role.has(perm) || role.has('*')) return true
  }
  return false
}

/**
 * Role to permissions list resolver
 */
const resolve = name => {
  let role = rbac.get(name) || nullRole
  return role[SPEC] ? role : compile(name, /* spec */ role)
}

/**
 * Setup and prebuild (optionally) RBAC roles
 */
const setup = (specs, prebuild = true) => {
  refs.clear()
  rbac.clear()
  for (let [name, spec] of Object.entries(specs)) rbac.set(name, spec)
  prebuild && build()
  return RBAC
}

/**
 * Clean role definition
 */
const unset = name => {
  rbac.delete(name)
  // recompile dependent roles
  let deps = refs.get(name)
  if (deps) for (let role of deps) compile(role)
}

// export RBAC API
const RBAC = {
  /* DEBUG */
  ...(debug && { SPEC, rbac, refs }),
  /* DEBUG */
  RX_DELIMITER: /[,\s]+/,
  EXCLUDE_MARK: '!',
  ROLE_REF_MARK: '@',
  Error: RBACError,
  build,
  apply,
  match,
  resolve,
  setup,
  unset
}

module.exports = exports = RBAC
