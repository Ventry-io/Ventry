ALTER TABLE "RegistrationItem" DROP CONSTRAINT "RegistrationItem_productId_fkey";
ALTER TABLE "RegistrationItem" ADD CONSTRAINT "RegistrationItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WaitlistEntry" DROP CONSTRAINT "WaitlistEntry_productId_fkey";
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
