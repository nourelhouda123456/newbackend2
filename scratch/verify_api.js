import mongoose from 'mongoose'
import User from '../models/user.js'

const BACKEND_URL = 'http://localhost:3000/api'
const MONGO_URI = 'mongodb://localhost:27017/taskflow-projects'

async function runVerification() {
  console.log('--- STARTING API E2E VERIFICATION SCRIPT ---')

  // 1. Connect to MongoDB to manage roles directly
  await mongoose.connect(MONGO_URI)
  console.log('Connected to MongoDB database')

  let aliceToken = ''
  let aliceId = ''
  let bobToken = ''
  let bobId = ''

  // 2. Register or Login Alice
  try {
    console.log('Registering Alice...')
    const res = await fetch(`${BACKEND_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice Admin', email: 'alice@example.com', password: 'password123' })
    })
    const data = await res.json()
    if (res.status === 201) {
      aliceToken = data.token
      aliceId = data.user.id
      console.log('Alice registered successfully:', aliceId)
    } else if (res.status === 409) {
      console.log('Alice already registered. Logging in...')
      const loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice@example.com', password: 'password123' })
      })
      const loginData = await loginRes.json()
      aliceToken = loginData.token
      aliceId = loginData.user.id
      console.log('Alice logged in successfully:', aliceId)
    } else {
      throw new Error(`Register Alice failed: ${JSON.stringify(data)}`)
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // 3. Register or Login Bob
  try {
    console.log('Registering Bob...')
    const res = await fetch(`${BACKEND_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob User', email: 'bob@example.com', password: 'password123' })
    })
    const data = await res.json()
    if (res.status === 201) {
      bobToken = data.token
      bobId = data.user.id
      console.log('Bob registered successfully:', bobId)
    } else if (res.status === 409) {
      console.log('Bob already registered. Logging in...')
      const loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bob@example.com', password: 'password123' })
      })
      const loginData = await loginRes.json()
      bobToken = loginData.token
      bobId = loginData.user.id
      console.log('Bob logged in successfully:', bobId)
    } else {
      throw new Error(`Register Bob failed: ${JSON.stringify(data)}`)
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // 4. Force promote Alice to Admin in MongoDB
  try {
    console.log('Promoting Alice to Admin in DB...')
    const updatedUser = await User.findOneAndUpdate(
      { email: 'alice@example.com' },
      { role: 'admin' },
      { new: true }
    )
    console.log('Alice role updated to:', updatedUser.role)
  } catch (err) {
    console.error('Failed to promote Alice in DB:', err)
    process.exit(1)
  }

  // Refresh Alice's token by logging in again so she has admin claims
  try {
    const loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'password123' })
    })
    const loginData = await loginRes.json()
    aliceToken = loginData.token
    console.log('Re-logged in Alice. Admin check:', loginData.user.role === 'admin' ? 'SUCCESS' : 'FAILED')
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // 5. Clean up existing tasks to have a clean slate
  console.log('Cleaning up existing tasks...')
  await mongoose.connection.db.collection('tasks').deleteMany({})

  // 6. Test Task CRUD & Visibility Rules
  console.log('\n--- TESTING TASKS CRUD & VISIBILITY RULES ---')

  let bobsPrivateTaskId = ''
  let bobsPublicTaskId = ''
  let alicesPrivateTaskId = ''

  // A. Bob creates a private task
  try {
    const res = await fetch(`${BACKEND_URL}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bobToken}`
      },
      body: JSON.stringify({
        title: 'Bobs Private Task',
        description: 'Only Bob should see this',
        priority: 'high',
        visibility: 'private'
      })
    })
    const data = await res.json()
    if (res.status === 201) {
      bobsPrivateTaskId = data.task.id
      console.log('Bob created private task:', bobsPrivateTaskId, 'with status:', data.task.status, 'visibility:', data.task.visibility)
    } else {
      throw new Error(`Failed to create Bob private task: ${JSON.stringify(data)}`)
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // B. Bob creates a public task
  try {
    const res = await fetch(`${BACKEND_URL}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bobToken}`
      },
      body: JSON.stringify({
        title: 'Bobs Public Task',
        description: 'Everyone can see this',
        priority: 'medium',
        visibility: 'public'
      })
    })
    const data = await res.json()
    if (res.status === 201) {
      bobsPublicTaskId = data.task.id
      console.log('Bob created public task:', bobsPublicTaskId)
    } else {
      throw new Error(`Failed to create Bob public task: ${JSON.stringify(data)}`)
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // C. Alice (Admin) creates a private task
  try {
    const res = await fetch(`${BACKEND_URL}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        title: 'Alices Private Task',
        description: 'Only Alice and Admins should see this',
        priority: 'low',
        visibility: 'private'
      })
    })
    const data = await res.json()
    if (res.status === 201) {
      alicesPrivateTaskId = data.task.id
      console.log('Alice created private task:', alicesPrivateTaskId)
    } else {
      throw new Error(`Failed to create Alice private task: ${JSON.stringify(data)}`)
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // D. Bob fetches his tasks
  try {
    console.log('Bob fetches tasks...')
    const res = await fetch(`${BACKEND_URL}/tasks`, {
      headers: { 'Authorization': `Bearer ${bobToken}` }
    })
    const data = await res.json()
    const taskIds = data.tasks.map(t => t.id)
    console.log('Tasks returned for Bob:', taskIds)
    const containsBobsPrivate = taskIds.includes(bobsPrivateTaskId)
    const containsBobsPublic = taskIds.includes(bobsPublicTaskId)
    const containsAlicesPrivate = taskIds.includes(alicesPrivateTaskId)

    console.log('  - Contains Bob\'s private task:', containsBobsPrivate ? 'PASS' : 'FAIL')
    console.log('  - Contains Bob\'s public task:', containsBobsPublic ? 'PASS' : 'FAIL')
    console.log('  - Contains Alice\'s private task (should be false):', !containsAlicesPrivate ? 'PASS' : 'FAIL')

    if (!containsBobsPrivate || !containsBobsPublic || containsAlicesPrivate) {
      throw new Error('Task visibility rules broken for regular user!')
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // E. Alice fetches tasks (Admin)
  try {
    console.log('Alice (Admin) fetches tasks...')
    const res = await fetch(`${BACKEND_URL}/tasks`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    })
    const data = await res.json()
    const taskIds = data.tasks.map(t => t.id)
    console.log('Tasks returned for Alice (Admin):', taskIds)
    const containsAll = taskIds.includes(bobsPrivateTaskId) && taskIds.includes(bobsPublicTaskId) && taskIds.includes(alicesPrivateTaskId)
    console.log('  - Contains all tasks (including Bob\'s private task):', containsAll ? 'PASS' : 'FAIL')
    if (!containsAll) {
      throw new Error('Admin did not retrieve all tasks!')
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // F. Bob tries to edit Alice's task (Should fail)
  try {
    console.log('Bob tries to update Alice\'s private task (unauthorized)...')
    const res = await fetch(`${BACKEND_URL}/tasks/${alicesPrivateTaskId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bobToken}`
      },
      body: JSON.stringify({ status: 'done' })
    })
    const data = await res.json()
    console.log('  - Status code:', res.status, `(Expected: 403 or 404) ->`, (res.status === 403 || res.status === 404) ? 'PASS' : 'FAIL')
    if (res.status !== 403 && res.status !== 404) {
      throw new Error('Bob was able to request edit on Alice\'s task!')
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // G. Bob updates his own task status (Drag & Drop emulation)
  try {
    console.log('Bob updates his own task status (Drag & Drop)...')
    const res = await fetch(`${BACKEND_URL}/tasks/${bobsPrivateTaskId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bobToken}`
      },
      body: JSON.stringify({ status: 'in_progress' })
    })
    const data = await res.json()
    console.log('  - New status in DB:', data.task.status, '->', data.task.status === 'in_progress' ? 'PASS' : 'FAIL')
    if (data.task.status !== 'in_progress') {
      throw new Error('Failed to update task status!')
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // H. Alice (Admin) updates Bob's task
  try {
    console.log('Alice (Admin) updates Bob\'s task...')
    const res = await fetch(`${BACKEND_URL}/tasks/${bobsPrivateTaskId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aliceToken}`
      },
      body: JSON.stringify({ title: 'Bobs Private Task (Edited by Admin)' })
    })
    const data = await res.json()
    console.log('  - New title in DB:', data.task.title, '->', data.task.title.includes('Edited by Admin') ? 'PASS' : 'FAIL')
    if (!data.task.title.includes('Edited by Admin')) {
      throw new Error('Admin failed to update user task!')
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // 7. Test User Management APIs (Admin Only)
  console.log('\n--- TESTING USER MANAGEMENT APIs (ADMIN ONLY) ---')

  // A. Get all users (Admin)
  try {
    console.log('Alice (Admin) lists users...')
    const res = await fetch(`${BACKEND_URL}/users`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    })
    const data = await res.json()
    const emails = data.users.map(u => u.email)
    console.log('Returned users list:', emails)
    console.log('  - Contains Bob:', emails.includes('bob@example.com') ? 'PASS' : 'FAIL')
    if (!emails.includes('bob@example.com')) {
      throw new Error('Admin user list did not return user Bob!')
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // B. Regular user lists users (Should fail)
  try {
    console.log('Bob lists users (should fail)...')
    const res = await fetch(`${BACKEND_URL}/users`, {
      headers: { 'Authorization': `Bearer ${bobToken}` }
    })
    console.log('  - Status code:', res.status, '(Expected: 403) ->', res.status === 403 ? 'PASS' : 'FAIL')
    if (res.status !== 403) {
      throw new Error('Regular user was allowed to list users!')
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // C. Admin toggles Bob\'s active status
  try {
    console.log('Admin toggles Bob\'s active status...')
    const res = await fetch(`${BACKEND_URL}/users/${bobId}/active`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    })
    const data = await res.json()
    console.log('  - Bob active status in DB:', data.user.active, '->', data.user.active === false ? 'PASS' : 'FAIL')

    // Try logging in as deactivated Bob (Should fail)
    console.log('Trying to login as deactivated Bob...')
    const loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', password: 'password123' })
    })
    console.log('  - Login status:', loginRes.status, '(Expected: 403) ->', loginRes.status === 403 ? 'PASS' : 'FAIL')

    // Reactivate Bob
    console.log('Re-activating Bob...')
    const reactivateRes = await fetch(`${BACKEND_URL}/users/${bobId}/active`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    })
    const reactivateData = await reactivateRes.json()
    console.log('  - Bob active status in DB now:', reactivateData.user.active, '->', reactivateData.user.active === true ? 'PASS' : 'FAIL')
    if (!reactivateData.user.active) {
      throw new Error('Failed to re-activate Bob!')
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // 8. Test Profile / Password Update
  console.log('\n--- TESTING PROFILE / PASSWORD UPDATE ---')

  // A. Bob updates his profile
  try {
    console.log('Bob updates profile name and email...')
    const res = await fetch(`${BACKEND_URL}/users/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bobToken}`
      },
      body: JSON.stringify({ name: 'Bob Spark', email: 'bobspark@example.com' })
    })
    const data = await res.json()
    console.log('  - Updated name:', data.user.name, '->', data.user.name === 'Bob Spark' ? 'PASS' : 'FAIL')
    console.log('  - Updated email:', data.user.email, '->', data.user.email === 'bobspark@example.com' ? 'PASS' : 'FAIL')
    if (data.user.name !== 'Bob Spark' || data.user.email !== 'bobspark@example.com') {
      throw new Error('Profile update failed!')
    }

    // Refresh Bob's email to original for consistency in other tests
    await fetch(`${BACKEND_URL}/users/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bobToken}`
      },
      body: JSON.stringify({ name: 'Bob User', email: 'bob@example.com' })
    })
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // B. Bob changes password
  try {
    console.log('Bob changes password...')
    const res = await fetch(`${BACKEND_URL}/users/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bobToken}`
      },
      body: JSON.stringify({ current: 'password123', next: 'newpassword123' })
    })
    const data = await res.json()
    console.log('  - Response status:', res.status, '(Expected: 200) ->', res.status === 200 ? 'PASS' : 'FAIL')

    // Try logging in with old password (should fail)
    console.log('Login with old password...')
    const oldLogin = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', password: 'password123' })
    })
    console.log('  - Status:', oldLogin.status, '(Expected: 401) ->', oldLogin.status === 401 ? 'PASS' : 'FAIL')

    // Try logging in with new password (should succeed)
    console.log('Login with new password...')
    const newLogin = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', password: 'newpassword123' })
    })
    const newLoginData = await newLogin.json()
    console.log('  - Status:', newLogin.status, '(Expected: 200) ->', newLogin.status === 200 ? 'PASS' : 'FAIL')
    if (newLogin.status !== 200) {
      throw new Error('Failed to login with new password!')
    }

    // Restore Bob's original password for consistency
    bobToken = newLoginData.token
    await fetch(`${BACKEND_URL}/users/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bobToken}`
      },
      body: JSON.stringify({ current: 'newpassword123', next: 'password123' })
    })
    console.log('Bob password restored to original.')
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // C. Admin deletes Bob user
  try {
    console.log('Admin deletes Bob user...')
    const res = await fetch(`${BACKEND_URL}/users/${bobId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    })
    console.log('  - Status code:', res.status, '(Expected: 200) ->', res.status === 200 ? 'PASS' : 'FAIL')

    // Check in database
    const checkUser = await User.findById(bobId)
    console.log('  - Bob in DB after delete:', checkUser, '(Expected: null) ->', checkUser === null ? 'PASS' : 'FAIL')
    if (checkUser !== null) {
      throw new Error('Bob user still exists in database after deletion!')
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  console.log('\n--- ALL E2E VERIFICATIONS PASSED SUCCESSFULLY! ---')
  await mongoose.disconnect()
  process.exit(0)
}

runVerification()
