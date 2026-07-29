import { useState } from 'react'
import Entry from './components/Entry'
import Workspace from './components/Workspace'

function App() {
  const [session, setSession] = useState(null)

  if (!session) return <Entry onStart={(topic) => setSession({ topic })} />

  return <Workspace topicId={session.topic} />
}

export default App
