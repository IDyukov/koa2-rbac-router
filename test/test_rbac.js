/**
 * lib/rbac.js tests
*/

/* eslint-disable prefer-const */

'use strict'

const test = require('ava')

// testing subject
const RBAC = require('../lib/rbac')

// helper
const mapToArray = m =>
  Array.from(
    m.entries()).map(v =>
    [v[0], v[1] instanceof Set ? Array.from(v[1]) : v[1]])

const testRoles = {
  role_1: ['perm_1.1', 'perm_1.2', 'perm_1.3'],
  role_2: '@role_1 !perm_1.3 perm_2.1 perm_2.2 @role_0.1',
  role_3: ['@role_2', 'perm_3.1', 'perm_3.2'],
  role_4: '@role_3 !@role_1 !@role_0.2',
  role_5: '*'
}

test('RBAC: setup', assert => {
  RBAC.setup(testRoles)

  assert.deepEqual(mapToArray(RBAC.rbac), [
    ['role_1', ['perm_1.1', 'perm_1.2', 'perm_1.3']],
    ['role_2', ['perm_1.1', 'perm_1.2', 'perm_2.1', 'perm_2.2']],
    ['role_3', ['perm_1.1', 'perm_1.2', 'perm_2.1', 'perm_2.2', 'perm_3.1', 'perm_3.2']],
    ['role_4', ['perm_2.1', 'perm_2.2', 'perm_3.1', 'perm_3.2']],
    ['role_5', ['*']]
  ])
})

test('RBAC: build', assert => {
  assert.plan(2)
  RBAC.setup(testRoles, false)
  assert.deepEqual(mapToArray(RBAC.rbac), [
    ['role_1', ['perm_1.1', 'perm_1.2', 'perm_1.3']],
    ['role_2', '@role_1 !perm_1.3 perm_2.1 perm_2.2 @role_0.1'],
    ['role_3', ['@role_2', 'perm_3.1', 'perm_3.2']],
    ['role_4', '@role_3 !@role_1 !@role_0.2'],
    ['role_5', '*']
  ])
  RBAC.build()
  assert.deepEqual(mapToArray(RBAC.rbac), [
    ['role_1', ['perm_1.1', 'perm_1.2', 'perm_1.3']],
    ['role_2', ['perm_1.1', 'perm_1.2', 'perm_2.1', 'perm_2.2']],
    ['role_3', ['perm_1.1', 'perm_1.2', 'perm_2.1', 'perm_2.2', 'perm_3.1', 'perm_3.2']],
    ['role_4', ['perm_2.1', 'perm_2.2', 'perm_3.1', 'perm_3.2']],
    ['role_5', ['*']]
  ])
})

test('RBAC: apply', assert => {
  RBAC.setup(testRoles)
  RBAC.apply('role_1', 'newPerm_1.1, newPerm_1.2')
  assert.deepEqual(mapToArray(RBAC.rbac), [
    ['role_1', ['newPerm_1.1', 'newPerm_1.2']],
    ['role_2', ['newPerm_1.1', 'newPerm_1.2', 'perm_2.1', 'perm_2.2']],
    ['role_3', ['newPerm_1.1', 'newPerm_1.2', 'perm_2.1', 'perm_2.2', 'perm_3.1', 'perm_3.2']],
    ['role_4', ['perm_2.1', 'perm_2.2', 'perm_3.1', 'perm_3.2']],
    ['role_5', ['*']]
  ])
})

test('RBAC: match', assert => {
  assert.plan(3)
  RBAC.setup(testRoles)
  assert.true(RBAC.match('perm_1.1', 'role_1'))
  assert.false(RBAC.match('invalidPerm', 'role_1'))
  assert.false(RBAC.match('perm_1', 'invalidRole'))
})

test('RBAC: unset', assert => {
  RBAC.setup(testRoles)
  RBAC.unset('role_1')
  assert.deepEqual(mapToArray(RBAC.rbac), [
    ['role_2', ['perm_2.1', 'perm_2.2']],
    ['role_3', ['perm_2.1', 'perm_2.2', 'perm_3.1', 'perm_3.2']],
    ['role_4', ['perm_2.1', 'perm_2.2', 'perm_3.1', 'perm_3.2']],
    ['role_5', ['*']]
  ])
})

test('RBAC: resolve', assert => {
  RBAC.setup(testRoles)
  assert.deepEqual(
    Array.from(RBAC.resolve('role_4')),
    ['perm_2.1', 'perm_2.2', 'perm_3.1', 'perm_3.2']
  )
  RBAC.setup(testRoles, false)
  assert.deepEqual(
    Array.from(RBAC.resolve('role_4')),
    ['perm_2.1', 'perm_2.2', 'perm_3.1', 'perm_3.2']
  )
})

test('RBAC: role with no specification', assert => {
  assert.throws(() => RBAC.apply('testRole'),
    'could not compile role \'testRole\': no specification'
  )
})

test('RBAC: role with invalid specification', assert => {
  assert.throws(
    () => RBAC.setup({ testRoleRole: true }),
    'invalid specification: true')
})

test('RBAC: role with invalid exclude role reference', assert =>
  assert.throws(
    () => RBAC.apply('testRole', 'perm_1 !@ perm_2'),
    'could not compile role \'testRole\': invalid exclude role reference'
  )
)

test('RBAC: role with invalid exclude specification', assert =>
  assert.throws(
    () => RBAC.apply('testRole', 'perm_1 ! perm_2'),
    'could not compile role \'testRole\': invalid exclude specification'
  )
)

test('RBAC: role with invalid role reference', assert =>
  assert.throws(
    () => RBAC.apply('testRole', 'perm_1 @ perm_2'),
    'could not compile role \'testRole\': invalid role reference'
  )
)

test('RBAC: wildecard role', assert => {
  RBAC.setup(testRoles)
  assert.true(RBAC.match('undefinedPerm', 'role_5'))
})
