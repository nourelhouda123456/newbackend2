import mongoose from 'mongoose'

const activityLogSchema = new mongoose.Schema({
  // Utilisateur concerné (null si non authentifié)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  // Nom d'action : LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, TASK_CREATED,
  //                TASK_UPDATED, TASK_STATUS_CHANGED, TASK_DELETED, etc.
  action: {
    type: String,
    required: true,
    trim: true,
  },
  // Adresse IP du client
  ip: {
    type: String,
    default: 'unknown',
  },
  // User-Agent du navigateur
  userAgent: {
    type: String,
    default: '',
  },
  // Données contextuelles libres (ex: { email, taskId, from, to })
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { timestamps: true })

// Index pour accélérer les recherches par utilisateur et par date
activityLogSchema.index({ userId: 1, createdAt: -1 })
activityLogSchema.index({ action: 1, createdAt: -1 })

activityLogSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    return ret
  }
})

export default mongoose.model('ActivityLog', activityLogSchema)
