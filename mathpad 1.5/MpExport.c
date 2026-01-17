/* MpExport: Exports the records from a backed up MathPad database file
 * to a simple ASCII text file so they can be given/emailed to others,
 * edited with your favorite text editor, printed, etc.  Use MpImport
 * to import the text records back into your MathPad database file.
 *
 * Written in plain vanilla ANSI standard C; should compile pretty easily
 * with any regular C compiler.  Released to the public domain.
 *
 * Version 1.0, 28 Sep 1997, Rick Huebner
 */
#include <stddef.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

#include "mpdb.h"



void main(int argc, char *argv[]) {
   FILE *db, *text;
   size_t length;
   long listpos;
   Word recnum;
   Byte catnum;
   Boolean secret;
   int c;
   DatabaseHdrType hdr;
   AppInfoType info;
   RecordListType reclist;
   RecordEntryPtr entries, entryptr;
   MathPadItemType item;

   /* Check for the proper command line format */
   if (argc != 3) {
      puts("Format: MPEXPORT DbFileName TextFileName");
      exit(1);
   }

   /* Open the MathPad database file to be read.  NOTE: "rb"
      indicates "binary" file type with no CR/LF text translation.
      You may need to change this to "r" if "rb" isn't supported
      by your compiler, but call setmode() or whatever as required
      to make sure no translations are done for this file. */
   db = fopen(argv[1], "rb");
   if (!db) {
      printf("Can't open \"%s\": %s", argv[1], strerror(errno));
      exit(1);
   }

   /* Open the text file to be written.  If CR/LF text translations
      are required for your system, they should be enabled here.
      Text translations are on by default under Microsoft C, and
      will write all '\n' characters as a CR/LF pair.  Translations
      aren't needed under Unix.  I don't know about Macs. */
   text = fopen(argv[2], "w");
   if (!text) {
      printf("Can't open \"%s\": %s", argv[2], strerror(errno));
      exit(1);
   }

   /* Read the database header */
   length = offsetof(DatabaseHdrType, recordList);
   if (fread(&hdr, 1, length, db) != length) {
      perror("Error reading database header");
      exit(1);
   }

   /* Make sure we know how to handle this database file */
   if (strncmp((char *)&hdr.type, MathPadType, 4) || strncmp((char *)&hdr.creator, MathPadCreator, 4)) {
      puts("Not a MathPad database file");
      exit(1);
   }

   SwapWord(&hdr.version);
   if (hdr.version != MathPadVersion) {
      puts("Don't know how to read this version of MathPad database.");
      puts("Please get the latest version of MpExport and try again.");
      exit(1);
   }

   /* Remember our current file position so we can come back here
      to read the (first?) record list header. */
   listpos = ftell(db);

   /* Go to and read the app info block (category data). */
   SwapDWord(&hdr.appInfoID);
   fseek(db, hdr.appInfoID, SEEK_SET);
   if (fread(&info, 1, sizeof(info), db) != sizeof(info)) {
      perror("Error reading database app info block");
      exit(1);
   }

   /* Process the linked list of record lists */
   do {
      /* Go to and read this record list header */
      fseek(db, listpos, SEEK_SET);
      length = offsetof(RecordListType, firstEntry);
      if (fread(&reclist, 1, length, db) != length) {
         perror("Error reading database record list");
         exit(1);
      }

      SwapWord(&reclist.numRecords);
      if (reclist.numRecords > 0) {
         /* Allocate memory for the correct size array of record entries */
         length = reclist.numRecords * sizeof(RecordEntryType);
         entries = malloc(length);
         if (!entries) {
            perror("malloc() failure");
            exit(1);
         }

         /* Read the record list entries into our array */
         if (fread(entries, 1, length, db) != length) {
            perror("Error reading database record entries");
            exit(1);
         }

         /* Export each record in the record entry array */
         for (entryptr = entries, recnum = 0; recnum < reclist.numRecords; ++recnum, ++entryptr) {
            /* Extract the category number and Secret flag from this entry */
            catnum = entryptr->attributes & dmRecAttrCategoryMask;
            secret = (entryptr->attributes & dmRecAttrSecret) != 0;

            /* Go to this record in the file */
            SwapDWord(&entryptr->localChunkID);
            fseek(db, entryptr->localChunkID, SEEK_SET);

            /* Read the MathPad record header */
            length = offsetof(MathPadItemType, text);
            if (fread(&item, 1, length, db) != length) {
               perror("Error reading database record");
               exit(1);
            }

            /* Print the record settings */
            fprintf(text, CategoryLine, info.categoryLabels[catnum], secret);
            fprintf(text, PlacesLine, item.places, item.stripzeros);

            /* Print the record text */
            while ((c = fgetc(db)) > 0)
               fputc(c, text);
            fputc('\n', text);

            fputs(SeparatorLine, text);
         }

         /* Free this record entry array */
         free(entries);
      }

      /* Get the position of the next record list in the chain, if any */
      SwapDWord(&reclist.nextRecordListID);
      listpos = reclist.nextRecordListID;
   } while (listpos);

   /* All done; clean up and exit */
   fclose(text);
   fclose(db);
}



/* Routines to translate a value between Motorola-style storage format 
 * (MSB first) and Intel-style storage format (LSB first).
 */
#ifdef LITTLE_ENDIAN
void SwapWord(void *p) {
   Byte *bp = (Byte *)p, temp;

   temp = bp[0];
   bp[0] = bp[1];
   bp[1] = temp;
}



void SwapDWord(void *p) {
   Word *wp = (Word *)p, temp;

   temp = wp[0];
   wp[0] = wp[1];
   wp[1] = temp;
   SwapWord(wp);
   SwapWord(wp+1);
}
#endif   
