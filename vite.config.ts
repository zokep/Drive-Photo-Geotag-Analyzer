import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// COOP 'same-origin-allow-popups' wajib agar popup login Google bisa mengembalikan token
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' }
export default defineConfig({ plugins: [react()], server: { port: 5173, headers }, preview: { headers } })
