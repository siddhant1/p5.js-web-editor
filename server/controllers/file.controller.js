import each from 'async/each';
import isBefore from 'date-fns/is_before';
import Project from '../models/project';
import { resolvePathToFile } from '../utils/filePath';
import { deleteObjectsFromS3, getObjectKey } from './aws.controller';

// Bug -> timestamps don't get created, but it seems like this will
// be fixed in mongoose soon
// https://github.com/Automattic/mongoose/issues/4049
export async function createFile(req, res) {
  try {
    let updatedProject = await Project.findOneAndUpdate(
      {
        _id: req.params.project_id,
        user: req.user._id
      },
      {
        $push: {
          files: req.body
        }
      },
      {
        new: true
      }
    );

    if (!updatedProject) {
      res.status(403).send({
        success: false,
        message: 'Project does not exist, or user does not match owner.'
      });
      return;
    }
    const newFile = updatedProject.files[updatedProject.files.length - 1];
    updatedProject.files.id(req.body.parentId).children.push(newFile.id);
    try {
      updatedProject = await updatedProject.save();
      res.json(updatedProject.files[updatedProject.files.length - 1]);
    } catch (innerErr) {
      console.log(innerErr);
      res.json({ success: false });
    }
  } catch (err) {
    res.status(403).send({
      success: false,
      message: 'Project does not exist, or user does not match owner.'
    });
  }
}

function getAllDescendantIds(files, nodeId) {
  const parentFile = files.find(file => file.id === nodeId);
  if (!parentFile) return [];
  return parentFile.children.reduce(
    (acc, childId) => [...acc, childId, ...getAllDescendantIds(files, childId)],
    []
  );
}

function deleteMany(files, ids) {
  const objectKeys = [];

  each(
    ids,
    (id, cb) => {
      if (files.id(id).url) {
        if (
          !process.env.S3_DATE ||
          (process.env.S3_DATE &&
            isBefore(
              new Date(process.env.S3_DATE),
              new Date(files.id(id).createdAt)
            ))
        ) {
          const objectKey = getObjectKey(files.id(id).url);
          objectKeys.push(objectKey);
        }
      }
      files.id(id).remove();
      cb();
    },
    (err) => {
      deleteObjectsFromS3(objectKeys);
    }
  );
}

function deleteChild(files, parentId, id) {
  return files.map((file) => {
    if (file.id === parentId) {
      file.children = file.children.filter(child => child !== id);
      return file;
    }
    return file;
  });
}

export async function deleteFile(req, res) {
  try {
    let project = await Project.findById(req.params.project_id);
    if (!project) {
      res
        .status(404)
        .send({ success: false, message: 'Project does not exist.' });
      return;
    }
    if (!project.user.equals(req.user._id)) {
      res.status(403).send({
        success: false,
        message: 'Session does not match owner of project.'
      });
      return;
    }
    const fileToDelete = project.files.find(file => file.id === req.params.file_id);
    if (!fileToDelete) {
      res
        .status(404)
        .send({ success: false, message: 'File does not exist in project.' });
      return;
    }

    // make sure file exists for project
    const idsToDelete = getAllDescendantIds(project.files, req.params.file_id);
    deleteMany(project.files, [req.params.file_id, ...idsToDelete]);
    project.files = deleteChild(
      project.files,
      req.query.parentId,
      req.params.file_id
    );
    project = await project.save();
    res.json(project.files);
  } catch (err) {
    res.status(500);
    console.log(err);
  }
}

export async function getFileContent(req, res) {
  try {
    const project = await Project.findById(req.params.project_id);
    const filePath = req.params[0];
    const resolvedFile = resolvePathToFile(filePath, project.files);
    if (!resolvedFile) {
      res.status(404).send({
        success: false,
        message: 'File with that name and path does not exist.'
      });
      return;
    }
    res.send(resolvedFile.content);
  } catch (err) {
    res.status(404).send({
      success: false,
      message: 'Project with that id does not exist.'
    });
  }
}
