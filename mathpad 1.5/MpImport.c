/* MpImport: Imports a set of MathPad database records from a text file
 * created by MpExport back into a MathPad database file.
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
#include <time.h>
#include <ctype.h>

#include "mpdb.h"

/* MathPad records are held in memory as a linked list of these structs */
typedef struct Record {
   struct Record *next;
   Byte catnum, places;
   Boolean secret, stripzeros;
   char *text;
} Record, *RecordPtr;

typedef enum { YES, NO, ALL } ReplyType;

/* Global variables */
DatabaseHdrType Hdr;
MathPadAppInfoType MpInfo;
RecordPtr RecordList = NULL;
Word NumRecords = 0;

/* Function prototypes */
void LoadDB(FILE *db);
void ProcessImports(FILE *fp);
void SaveDB(FILE *db);
RecordPtr LoadImport(FILE *fp);
int  ReadLine(char *buff, int size, FILE *fp);
ReplyType Confirm(char *prefix, char *title);
void AddRecord(RecordPtr recptr);
RecordPtr FindRecord(char *title);
void ReplaceRecord(RecordPtr oldptr, RecordPtr newptr);
void FreeRecords(void);



void main(int argc, char *argv[]) {
   FILE *db, *text;
   char *outname;

   /* Check for the proper command line format */
   if (argc < 3 || argc > 4) {
      puts("Format: MPIMPORT OldDbFileName TextFileName [NewDbFileName]\n");
      puts("Specify NewDbFileName to create a new database file and leave");
      puts("OldDbFileName untouched as a backup, or omit NewDbFileName");
      puts("to update OldDbFileName in place.");
      exit(1);
   }

   /* Load the old database into memory.  NOTE: "rb"
      indicates "binary" file type with no CR/LF text translation.
      You may need to change this to "r" if "rb" isn't supported
      by your compiler, but call setmode() or whatever as required
      to make sure no translations are done for this file. */
   db = fopen(argv[1], "rb");
   if (!db) {
      printf("Can't open \"%s\": %s", argv[1], strerror(errno));
      exit(1);
   }
   LoadDB(db);
   fclose(db);

   /* Process the imports from the text file */
   text = fopen(argv[2], "r");
   if (!text) {
      printf("Can't open \"%s\": %s", argv[2], strerror(errno));
      exit(1);
   }
   ProcessImports(text);
   fclose(text);

   /* Write the updated database to disk */
   outname = (argc > 3) ? argv[3] : argv[1];
   db = fopen(outname, "wb");
   if (!db) {
      printf("Can't open \"%s\": %s", outname, strerror(errno));
      exit(1);
   }
   SaveDB(db);
   fclose(db);

   /* Done; clean up and exit */
   FreeRecords();
}



/* Load the source MathPad database file into memory */
void LoadDB(FILE *db) {
   size_t length;
   long listpos, textpos;
   Word recnum;
   RecordListType reclist;
   RecordEntryPtr entries, entryptr;
   MathPadItemType item;
   RecordPtr recptr;

   /* Read the database header */
   length = offsetof(DatabaseHdrType, recordList);
   if (fread(&Hdr, 1, length, db) != length) {
      perror("Error reading database header");
      exit(1);
   }

   /* Make sure we know how to handle this database file */
   if (strncmp((char *)&Hdr.type, MathPadType, 4) || strncmp((char *)&Hdr.creator, MathPadCreator, 4)) {
      puts("Not a MathPad database file");
      exit(1);
   }

   SwapWord(&Hdr.version);
   if (Hdr.version != MathPadVersion) {
      puts("Don't know how to read this version of MathPad database.");
      puts("Please get the latest version of MpImport and try again.");
      exit(1);
   }
   SwapWord(&Hdr.version);

   /* Remember our current file position so we can come back here
      to read the (first?) record list header. */
   listpos = ftell(db);

   /* Go to and read the app info block (category data). */
   SwapDWord(&Hdr.appInfoID);
   fseek(db, Hdr.appInfoID, SEEK_SET);
   if (fread(&MpInfo, 1, sizeof(MpInfo), db) != sizeof(MpInfo)) {
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

         /* Load each record in the record entry array */
         for (entryptr = entries, recnum = 0; recnum < reclist.numRecords; ++recnum, ++entryptr) {
            /* Allocate a new node for our linked list of MathPad records */
            recptr = malloc(sizeof(Record));
            if (!recptr) {
               perror("malloc() failure");
               exit(1);
            }

            /* Extract the category number and Secret flag from this entry */
            recptr->catnum = entryptr->attributes & dmRecAttrCategoryMask;
            recptr->secret = (entryptr->attributes & dmRecAttrSecret) != 0;

            /* Go to this record in the file */
            SwapDWord(&entryptr->localChunkID);
            fseek(db, entryptr->localChunkID, SEEK_SET);

            /* Read the MathPad record header and extract the settings */
            length = offsetof(MathPadItemType, text);
            if (fread(&item, 1, length, db) != length) {
               perror("Error reading database record");
               exit(1);
            }
            recptr->places = item.places;
            recptr->stripzeros = item.stripzeros;

            /* Remember where the record text starts */
            textpos = ftell(db);

            /* Count the number of bytes of text in this record */
            length = 1;
            while (fgetc(db) > 0)
               ++length;

            /* Allocate a block of memory to hold the record text */
            recptr->text = malloc(length);
            if (!recptr->text) {
               perror("malloc() failure");
               exit(1);
            }

            /* Go back to the start of the record text and read it
               into the allocated block */
            fseek(db, textpos, SEEK_SET);
            fread(recptr->text, 1, length, db);

            /* Add this loaded MathPad record to our linked list */
            AddRecord(recptr);
         }

         /* Free this record entry array */
         free(entries);
      }

      /* Get the position of the next record list in the chain, if any */
      SwapDWord(&reclist.nextRecordListID);
      listpos = reclist.nextRecordListID;
   } while (listpos);
}



/* Import each record from the text file into the set of records we
 * loaded into memory
 */
void ProcessImports(FILE *fp) {
   RecordPtr newrec, recptr;
   ReplyType reply;
   Boolean allok = FALSE;

   /* Import records until EOF */
   while ((newrec = LoadImport(fp)) != NULL) {
      /* Look for an existing record with the same title */
      recptr = FindRecord(newrec->text);

      /* If no such record already exists, go ahead an add it */
      if (!recptr)
         AddRecord(newrec);
      /* If this import is different than the existing record, ask
         user whether to overwrite the existing one or add this
         import as a separate record */
      else if (strcmp(newrec->text, recptr->text) ||
               newrec->catnum != recptr->catnum ||
               newrec->secret != recptr->secret ||
               newrec->places != recptr->places ||
               newrec->stripzeros != recptr->stripzeros) {
         reply = allok ? YES : Confirm("Overwrite", recptr->text);
         switch (reply) {
            case ALL:
               allok = TRUE;
               /* fallthrough */
            case YES:
               ReplaceRecord(recptr, newrec);
               break;
            case NO:
               AddRecord(newrec);
               break;
         }
      /* If this import exactly matches the existing record, skip it */
      } else {
         free(newrec->text);
         free(newrec);
      }
   }
}



/* Save the updated MathPad records to disk */
void SaveDB(FILE *db) {
   size_t length;
   long listpos;
   char *textptr;
   RecordListType reclist;
   RecordEntryPtr entries, entryptr;
   MathPadItemType item;
   RecordPtr recptr;

   /* Save space in the file for the database header.  We'll come
      back and rewrite this on the second pass, after we know the
      file offset for the app info block. */
   length = offsetof(DatabaseHdrType, recordList);
   if (fwrite(&Hdr, 1, length, db) != length) {
      perror("Error writing database header");
      exit(1);
   }

   /* Write the record list header */
   reclist.nextRecordListID = 0;
   reclist.numRecords = NumRecords;
   SwapWord(&reclist.numRecords);

   length = offsetof(RecordListType, firstEntry);
   if (fwrite(&reclist, 1, length, db) != length) {
      perror("Error writing database record list");
      exit(1);
   }

   /* Allocate memory for the correct size array of record entries */
   length = NumRecords * sizeof(RecordEntryType);
   entries = (RecordEntryPtr)malloc(length);
   if (!entries) {
      perror("malloc() failure");
      exit(1);
   }

   /* Save space in the file for the record list entries.  We'll come back
      and rewrite these with real values after we've determined the file
      offset and attributes for each. */
   listpos = ftell(db);
   if (fwrite(entries, 1, length, db) != length) {
      perror("Error writing database record entries");
      exit(1);
   }

   /* Write the app info block and save its location in the header */
   Hdr.appInfoID = ftell(db);
   SwapDWord(&Hdr.appInfoID);
   if (fwrite(&MpInfo, 1, sizeof(MpInfo), db) != sizeof(MpInfo)) {
      perror("Error writing database app info block");
      exit(1);
   }

   /* Write each MathPad record in our linked list */
   entryptr = entries;
   recptr = RecordList;
   while (recptr) {
      /* Fill in the record entry values for each record as it's written */
      entryptr->localChunkID = ftell(db);
      SwapDWord(&entryptr->localChunkID);
      entryptr->attributes = recptr->catnum;
      if (recptr->secret)
         entryptr->attributes |= dmRecAttrSecret;
      memset(entryptr->uniqueID, 0, sizeof(entryptr->uniqueID));
      ++entryptr;

      /* Write the MathPad record header */
      item.places = recptr->places;
      item.stripzeros = recptr->stripzeros;
      length = offsetof(MathPadItemType, text);
      if (fwrite(&item, 1, length, db) != length) {
         perror("Error writing database record");
         exit(1);
      }

      /* Write the MathPad record text */
      textptr = recptr->text;
      do {
         fputc(*textptr, db);
      } while (*textptr++);
 
      recptr = recptr->next;
   }

   /* Set the times in the header to the current time
      to prevent "invalid file deleted" problems on Macs */
   Hdr.creationDate = Hdr.modificationDate = Hdr.lastBackupDate = time(NULL);
   SwapDWord(&Hdr.creationDate);
   SwapDWord(&Hdr.modificationDate);
   SwapDWord(&Hdr.lastBackupDate);

   /* Rewrite the database header with the final values */
   rewind(db);
   length = offsetof(DatabaseHdrType, recordList);
   if (fwrite(&Hdr, 1, length, db) != length) {
      perror("Error rewriting database header");
      exit(1);
   }

   /* Rewrite the record entries with the final values */
   fseek(db, listpos, SEEK_SET);
   length = NumRecords * sizeof(RecordEntryType);
   if (fwrite(entries, 1, length, db) != length) {
      perror("Error rewriting database record entries");
      exit(1);
   }
}



/* Load one import record from the text file into memory */
RecordPtr LoadImport(FILE *fp) {
   int linelength, catlength, textlength, i;
   char buff[256], catname[dmCategoryLength], *start, *end;
   RecordPtr newrec;

   /* Read the first line of import text.  Ignore any blank lines
      so that excess trailing blank lines after the last record
      don't get loaded as a blank import record. */
   do {
      linelength = ReadLine(buff, sizeof(buff), fp);
   } while (linelength == 1);

   /* If we couldn't read anything, we're at EOF */
   if (linelength < 1)
      return NULL;

   /* Allocate a new MathPad record struct to hold the imported record */
   newrec = malloc(sizeof(Record));
   if (!newrec) {
      perror("malloc() failure");
      exit(1);
   }

   /* If the category/secret line is missing, use defaults */
   if (strncmp(buff, CategoryLine, CatTestLength)) {
      newrec->catnum = dmUnfiledCategory;
      newrec->secret = FALSE;
   } else {
      /* Extract the category name from between the quotes */
      start = strchr(buff, '\"') + 1;
      end = strchr(start, '\"');
      catlength = end - start;
      if (catlength >= dmCategoryLength)
         catlength = dmCategoryLength - 1;
      memcpy(catname, start, catlength);
      catname[catlength] = '\0';

      /* Look up the category number if it's already in the database */
      for (newrec->catnum = 0; newrec->catnum < dmRecNumCategories; ++newrec->catnum) {
         if (!strcmp(MpInfo.appinfo.categoryLabels[newrec->catnum], catname))
            break;
      }

      /* If the category isn't already in the database, add it if possible */
      if (newrec->catnum >= dmRecNumCategories) {
         /* Find the first unused category name slot */
         for (newrec->catnum = 0; newrec->catnum < dmRecNumCategories; ++newrec->catnum) {
            if (!MpInfo.appinfo.categoryLabels[newrec->catnum][0])
               break;
         }

         /* If all category names are in use, revert import to Unfiled */
         if (newrec->catnum >= dmRecNumCategories)
            newrec->catnum = dmUnfiledCategory;
         else {
            /* Copy the new category name into the unused slot */
            strcpy(MpInfo.appinfo.categoryLabels[newrec->catnum], catname);
            /* Set the new category's unique ID to the next unused value */
            do {
               ++MpInfo.appinfo.lastUniqID;
               for (i = 0; i < dmRecNumCategories; ++i)
                  if (MpInfo.appinfo.categoryUniqIDs[i] == MpInfo.appinfo.lastUniqID)
                     break;
            } while (i < dmRecNumCategories);
            MpInfo.appinfo.categoryUniqIDs[newrec->catnum] = MpInfo.appinfo.lastUniqID;
         }
      }

      /* Extract the secret flag value from after the = sign */
      start = strchr(end+1, '=') + 1;
      newrec->secret = atoi(start) != 0;

      /* Replace this line of import text with the next one */
      linelength = ReadLine(buff, sizeof(buff), fp);
      if (linelength < 1) {
         free(newrec);
         return NULL;
      }
   }

   /* If the places/stripzeros line is missing, use defaults */
   if (strncmp(buff, PlacesLine, PlacesTestLength)) {
      newrec->places = 14;
      newrec->stripzeros = TRUE;
   } else {
      /* Extract the decimal places setting from after the first = */
      start = strchr(buff, '=') + 1;
      newrec->places = (Byte)atoi(start);

      /* Extract the stripzeros flag value from after the second = */
      start = strchr(start, '=') + 1;
      newrec->stripzeros = atoi(start) != 0;

      /* Replace this line of import text with the next one */
      linelength = ReadLine(buff, sizeof(buff), fp);
      if (linelength < 1) {
         free(newrec);
         return NULL;
      }
   }

   /* Allocate a block of memory to hold the first line of record text */
   textlength = linelength;
   newrec->text = malloc(textlength);
   if (!newrec->text) {
      perror("malloc() failure");
      exit(1);
   }
   memcpy(newrec->text, buff, textlength);

   /* Since ftell/fseek are unreliable when using text translation mode,
      we can't just read the text to see how many bytes we need and then
      back up and re-read it into the memory block like we normally would.
      Instead, we'll read it in one pass, extending the memory block as
      required to append each line as we go. */
   while ((linelength = ReadLine(buff, sizeof(buff), fp)) > 0) {
      newrec->text = realloc(newrec->text, textlength+linelength);
      if (!newrec->text) {
         perror("realloc() failure");
         exit(1);
      }
      memcpy(newrec->text+textlength, buff, linelength);
      textlength += linelength;
   }
   newrec->text[textlength-1] = '\0';

   return newrec;
}



/* Read one line of import text, translating the end of line character
 * to the one used within the PalmPilot.  Returns -1 for EOF, 0
 * for end of record, or > 0 for bytes in line.
 */
int ReadLine(char *buff, int size, FILE *fp) {
   char *p;

   if (!fgets(buff, size, fp))
      return -1;

   if (!strncmp(buff, SeparatorLine, SepTestLength))
      return 0;

   p = buff;
   while (*p && *p != '\n' && *p != '\r')
      ++p;
   *p++ = PilotEOL;
   *p = '\0';

   return p - buff;
}



/* Ask the user for confirmation and return YES, NO, or ALL */
ReplyType Confirm(char *prefix, char *title) {
   char *p, buff[128];

   while (TRUE) {
      printf(prefix);
      if (title) {
         printf(" \"");
         p = title;
         while (*p && *p != PilotEOL) {
            putchar(*p);
            ++p;
         }
         putchar('\"');
      }
      printf(" (Yes/No/All)? ");
      fflush(stdout);

      fflush(stdin);
      gets(buff);

      switch (toupper(buff[0])) {
         case 'Y':
            return YES;
         case 'N':
            return NO;
         case 'A':
            return ALL;
      }
   }
}



/* Append a new MathPad record to the end of the linked list */
void AddRecord(RecordPtr recptr) {
   RecordPtr lastnode = (RecordPtr)&RecordList;

   while (lastnode->next)
      lastnode = lastnode->next;

   lastnode->next = recptr;
   recptr->next = NULL;

   ++NumRecords;
}



/* Search the linked list for a record with the specified tile */
RecordPtr FindRecord(char *title) {
   RecordPtr currnode = RecordList;
   char *p1, *p2;

   while (currnode) {
      p1 = title;
      p2 = currnode->text;
      while (*p1 && *p1 != PilotEOL && *p1 == *p2) {
         ++p1;
         ++p2;
      }
      if (*p1 == *p2)
         return currnode;

      currnode = currnode->next;
   }

   return NULL;
}



/* Replace the specified record in the linked list */
void ReplaceRecord(RecordPtr oldptr, RecordPtr newptr) {
   RecordPtr currnode, prevnode = (RecordPtr)&RecordList;

   while (prevnode->next) {
      currnode = prevnode->next;
      if (currnode != oldptr)
         prevnode = currnode;
      else {
         prevnode->next = newptr;
         newptr->next = oldptr->next;
         free(oldptr->text);
         free(oldptr);
         break;
      }
   }
}



/* Free all memory used by the linked list */
void FreeRecords(void) {
   RecordPtr currnode = RecordList, next;

   while (currnode) {
      free(currnode->text);
      next = currnode->next;
      free(currnode);
      currnode = next;
   }

   RecordList = NULL;
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
