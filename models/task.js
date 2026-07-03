import mongoose from 'mongoose'

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Le titre est obligatoire'],
    trim: true,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  status: {
    type: String,
    enum: ['todo', 'in_progress', 'blocked', 'done'],
    default: 'todo',
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },
  // 'public'  → visible par tous les utilisateurs connectés
  // 'private' → visible uniquement par le créateur
  visibility: {
    type: String,
    enum: ['public', 'private'],
    default: 'private',
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    default: null,
  },
  assignee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  comments: [{
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    }
  }],

  // ── Historique des changements de statut ────────────────────────────────
  // Chaque entrée représente une transition enregistrée (drag & drop inclus)
  statusHistory: [{
    previousStatus: {
      type: String,
      enum: ['todo', 'in_progress', 'blocked', 'done'],
    },
    newStatus: {
      type: String,
      enum: ['todo', 'in_progress', 'blocked', 'done'],
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
    // Note optionnelle (ex: "remis en cours par admin")
    note: {
      type: String,
      default: '',
    },
  }],

  // Date de fermeture (quand status passe à 'done')
  closedAt: {
    type: Date,
    default: null,
  },
  documents: [{
    name: { type: String, required: true },
    url: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now }
  }],
}, { timestamps: true })

// ── Hook : gestion automatique de closedAt ───────────────────────────────
taskSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    if (this.status === 'done' && !this.closedAt) {
      this.closedAt = new Date()
    } else if (this.status !== 'done' && this.closedAt) {
      this.closedAt = null
    }
  }
  next()
})

// Activer la conversion de _id en id lors de la sérialisation JSON
taskSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    return ret
  }
})

taskSchema.set('toObject', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    return ret
  }
})

export default mongoose.model('Task', taskSchema)