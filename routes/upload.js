import express from 'express'
import multer from 'multer'
import path from 'path'
import { protect } from '../middleware/auth.js'

const router = express.Router()

// Configuration Multer pour stocker dans 'uploads/'
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/')
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
})

const upload = multer({ storage })

router.post('/', protect, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Aucun fichier fourni.' })
  }
  // Retourne l'URL du fichier sur le serveur
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
  res.json({
    name: req.file.originalname,
    url: fileUrl,
    filename: req.file.filename
  })
})

export default router
