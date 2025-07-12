/*
  Warnings:

  - You are about to drop the column `answers` on the `Quiz` table. All the data in the column will be lost.
  - You are about to drop the column `completedAt` on the `Quiz` table. All the data in the column will be lost.
  - You are about to drop the column `score` on the `Quiz` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Quiz` table. All the data in the column will be lost.
  - Added the required column `difficulty` to the `Quiz` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maxScore` to the `Quiz` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalQuestions` to the `Quiz` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Quiz" DROP CONSTRAINT "Quiz_userId_fkey";

-- AlterTable
ALTER TABLE "Quiz" DROP COLUMN "answers",
DROP COLUMN "completedAt",
DROP COLUMN "score",
DROP COLUMN "userId",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "difficulty" TEXT NOT NULL,
ADD COLUMN     "maxScore" INTEGER NOT NULL,
ADD COLUMN     "totalQuestions" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
