// Erzeugt ein langes Zufallsgeheimnis für PIPELINE_SECRET und TOKEN_SECRET: npm run geheimnis
import { randomBytes } from 'node:crypto';
console.log(randomBytes(32).toString('base64url'));
